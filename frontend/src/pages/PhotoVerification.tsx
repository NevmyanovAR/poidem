import { ApiError } from '../api/client'
import { Modal } from '../components/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Camera, UserRound } from 'lucide-react'
import { useAutoRefresh } from '../lib/autoRefresh'
import { useAppData } from '../state/context'
import { useResource } from '../components/admin/common'
import { verificationLabels } from '../api/verification'
import type { VerificationRequest } from '../api/verification'
import { PhotoVerified } from '../components/PhotoVerified'
import '../verification.css'

export function PhotoVerification() {
  const { authorization } = useAppData()
  if (authorization.status !== 'verified') return <section className="settings-page"><h1>Подтвердить фото</h1><p>Войди через Telegram, чтобы начать</p><Link to="/profile">К анкете</Link></section>
  return <VerificationFlow key={authorization.userId} />
}

function VerificationFlow() {
  const { verification } = useAppData()
  const load = useCallback(() => verification.verificationStatus(), [verification])
  const resource = useResource('photo-verification', load)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [showTerms, setShowTerms] = useState(false)
  const [agreedVersion, setAgreedVersion] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const agreed = !!resource.data?.consent_version && agreedVersion === resource.data.consent_version
  const [challenge, setChallenge] = useState<VerificationRequest | null>(null)
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null), [camera, setCamera] = useState(false)
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null), epoch = useRef(0)
  useAutoRefresh(resource.refresh, !camera && !shot && !busy && !showWithdraw && !showTerms)
  const stop = useCallback(() => { epoch.current++; stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; setCamera(false) }, [])
  useEffect(() => () => { epoch.current++; stream.current?.getTracks().forEach(track => track.stop()) }, [])
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url) }, [shot])
  useEffect(() => { const visibility = () => { if (document.visibilityState !== 'visible') stop() }; document.addEventListener('visibilitychange', visibility); return () => document.removeEventListener('visibilitychange', visibility) }, [stop])
  useEffect(() => {
    if (camera && video.current && stream.current) {
      video.current.srcObject = stream.current
      void video.current.play().catch(() => { setError('Не удалось включить изображение камеры. Попробуй ещё раз'); stop() })
    }
  }, [camera, stop])
  function recoverRequest(reason: unknown) {
    if (reason instanceof ApiError && ['CONSENT_CHANGED', 'VERIFICATION_EXPIRED'].includes(reason.code)) {
      stop(); setShot(null); setChallenge(null); setAgreedVersion(''); resource.refresh()
    }
  }
  async function startCamera() {
    if (!agreed || !resource.data?.available || busy) return
    setBusy(true); setError('')
    const turn = ++epoch.current
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Камера недоступна. Открой Mini App на устройстве с камерой через HTTPS')
      const request = await verification.verificationChallenge(resource.data.consent_version)
      if (turn !== epoch.current) return
      if (request.submitted_at) { stop(); setShot(null); setChallenge(null); resource.refresh(); return }
      setChallenge(request)
      const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } } })
      if (turn !== epoch.current) { media.getTracks().forEach(track => track.stop()); return }
      stream.current?.getTracks().forEach(track => track.stop()); stream.current = media
      setShot(null); setCamera(true)
    } catch (reason) {
      recoverRequest(reason)
      const name = reason instanceof DOMException ? reason.name : ''
      setError(name === 'NotAllowedError' ? 'Доступ к камере запрещён. Разреши камеру в настройках Telegram или браузера и попробуй ещё раз' : name === 'NotFoundError' ? 'Камера не найдена на этом устройстве' : reason instanceof Error ? reason.message : 'Не удалось открыть камеру')
      stop()
    } finally { setBusy(false) }
  }
  async function capture() {
    const turn = epoch.current
    const source = video.current
    if (!source?.videoWidth || !source.videoHeight) { setError('Дождись изображения камеры'); return }
    const canvas = document.createElement('canvas'), scale = Math.min(1, 1280 / Math.max(source.videoWidth, source.videoHeight))
    canvas.width = Math.round(source.videoWidth * scale); canvas.height = Math.round(source.videoHeight * scale)
    canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .88))
    if (turn !== epoch.current) return
    if (!blob) { setError('Не удалось сделать снимок. Попробуй ещё раз'); return }
    setShot({ file: new File([blob], 'selfie.jpg', { type: 'image/jpeg' }), url: URL.createObjectURL(blob) }); stop()
  }
  async function send() {
    if (!shot || !challenge || busy) return
    setBusy(true); setError('')
    try { await verification.verificationSubmit(challenge.id, shot.file); setShot(null); setChallenge(null); stop(); resource.refresh() }
    catch (reason) { recoverRequest(reason); setError(reason instanceof Error ? reason.message : 'Не удалось отправить снимок') }
    finally { setBusy(false) }
  }
  const state = resource.data
  const capturing = camera || !!shot
  return <section className="settings-page verification-page" data-capturing={capturing}>
    <Link to="/settings" className="back-link"><ArrowLeft size={16} />Настройки</Link><h1>Подтвердить фото</h1>
    {resource.loading && !state && <p role="status">Загружаем статус…</p>}
    {resource.error && <p role="alert">{resource.error} <button className="text-link" onClick={resource.refresh}>Повторить</button></p>}
    {state && <>
      {!capturing && <>{state.photo_verified ? <PhotoVerified value /> : <p className="small-note" role="status">{verificationLabels[state.state]}</p>}
        {state.state === 'pending' && <p>Снимок отправлен. Модератор вручную сравнит его с фото анкеты</p>}
        {state.state === 'rejected' && state.request?.reason && <p>{state.request.reason}</p>}
        {!state.available && <p>Подтверждение фото пока недоступно</p>}
      </>}
      {state.available && !['pending', 'verified'].includes(state.state) && <>
        {!capturing && <>
          <p>Сделай селфи по инструкции. Модератор сравнит его с фото анкеты</p>
          <div className="verification-framing" aria-label="Пример кадра: лицо и плечи"><UserRound size={50} strokeWidth={1} /><span>Лицо и плечи в кадре</span></div>
          <label className="verification-agree"><input type="checkbox" checked={agreed} onChange={event => setAgreedVersion(event.target.checked ? state.consent_version : '')} /><span>Соглашаюсь на обработку проверочного снимка <button type="button" className="text-link verification-terms-link" onClick={event => { event.preventDefault(); setShowTerms(true) }}>Условия согласия</button></span></label>
          <button type="button" className="button button-primary" disabled={!agreed || busy} onClick={() => void startCamera()}><Camera size={18} />{busy ? 'Открываем камеру…' : 'Открыть камеру'}</button>
        </>}
        {challenge && capturing && <p className="verification-instruction">{challenge.instruction}</p>}
        {camera && <>
          <video className="verification-camera" ref={video} autoPlay playsInline muted aria-label="Предпросмотр камеры" />
          <div className="verification-camera-actions"><button type="button" className="button button-primary" onClick={() => void capture()}>Сделать снимок</button><button className="button button-outline" type="button" onClick={stop}>Закрыть камеру</button></div>
        </>}
        {shot && <>
          <img className="verification-shot" src={shot.url} alt="Проверочное селфи перед отправкой" />
          <div className="verification-preview-actions"><button type="button" className="button button-primary" disabled={busy} onClick={() => void send()}>{busy ? 'Отправляем…' : 'Отправить на проверку'}</button><button type="button" className="button button-outline" disabled={busy} onClick={() => void startCamera()}>Переснять</button><Link to="/settings" className="text-link">Закрыть экран</Link></div>
        </>}
      </>}
      {!capturing && state.request && !state.request.reason_code?.startsWith('consent_withdrawn') && <button type="button" className="text-link" disabled={busy} onClick={() => { setError(''); setShowWithdraw(true) }}>Отозвать согласие и удалить снимки</button>}
    </>}
    {showTerms && state && <Modal title="Условия согласия" decoration={false} closeLabel="Закрыть условия" onClose={() => setShowTerms(false)}>
      <p className="verification-consent">{state.consent_text}</p>
      {state.retention && <p className="verification-retention">После отправки снимки хранятся до {state.retention.pending_hours} ч ожидания проверки. {state.retention.reviewed_hours === 0 ? 'После решения снимки становятся недоступны и удаляются автоматически' : `После решения снимки хранятся ещё до ${state.retention.reviewed_hours} ч, затем удаляются автоматически`}. Согласие можно отозвать в любой момент</p>}
      <p>Выбери хорошее освещение. Лицо и жест должны быть хорошо видны. Документы не нужны</p><p>Это добровольная сверка фотографий, а не проверка личности. Камера и жест не гарантируют защиту от поддельных снимков</p>
    </Modal>}
    {showWithdraw && <Modal title="Отозвать согласие?" decoration={false} onClose={() => { if (!busy) setShowWithdraw(false) }}><p>Проверочные снимки станут недоступны и будут удалены. Отметка подтверждения исчезнет</p><button className="button button-outline" disabled={busy} onClick={async () => { if (!state?.request) return; setBusy(true); setError(''); try { await verification.verificationWithdraw(state.request!); stop(); setShot(null); setChallenge(null); setAgreedVersion(''); resource.refresh(); setShowWithdraw(false) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось отозвать согласие') } finally { setBusy(false) } }}>Отозвать согласие</button>{error && <p className="field-error" role="alert">{error}</p>}</Modal>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </section>
}
