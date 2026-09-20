/**
 * Loader-visible Cordis entry for the Native Companion named-pipe server.
 *
 * SelectionCompanionBridgeService depends only on the two plugin-owned
 * capabilities. Cordis therefore activates this row only after Context and
 * Session integration are live.
 */
export { SelectionCompanionBridgeService as default } from './server.js'
