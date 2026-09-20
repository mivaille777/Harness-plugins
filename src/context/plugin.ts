/**
 * Loader-visible Cordis entry for immutable selection snapshot state.
 *
 * Kept as a dedicated module so Harness can report this service's Fiber
 * independently from the Session and named-pipe layers.
 */
export { SelectionContextService as default } from './service.js'
