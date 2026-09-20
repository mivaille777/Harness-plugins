/**
 * Loader-visible Cordis entry for Harness Session / Agent integration.
 *
 * SelectionCompanionSessionService declares its Harness dependencies through
 * static inject, allowing Cordis to keep this Loader row PENDING until all
 * required services are available.
 */
export { SelectionCompanionSessionService as default } from './service.js'
