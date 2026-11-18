import type { Profile } from '../types'

// UI gate for local simulation only; real registration must be checked on the server.
export function isProfileReady(profile: Profile | null): profile is Profile {
  return !!profile && !!profile.name.trim() && profile.name.trim().length <= 40
    && /^\d+$/.test(profile.age) && Number.isSafeInteger(Number(profile.age)) && Number(profile.age) >= 18
    && !!profile.gender && !!profile.preference && !!profile.photo
    && !!profile.bio.trim() && profile.bio.trim().length <= 300
    && profile.interests.length === 3 && new Set(profile.interests).size === 3
}
