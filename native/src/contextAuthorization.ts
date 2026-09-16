import type { SelectionSnapshot } from '../../src/context/snapshot.js'
import type {
  SelectionMaterial,
  SelectionMaterialScope,
} from '../../src/session/material.js'
import type { SelectionExpansion } from './api/bridge'

export type ExpandableAuthorizationScope = Exclude<SelectionMaterialScope, 'selection'>

/**
 * Preview data is not authorization. This helper is the only Native-side path
 * that turns a displayed expansion into canonical request material.
 */
export function authorizeExpandedContext(
  snapshot: SelectionSnapshot,
  expansion: SelectionExpansion,
): SelectionMaterial {
  if (expansion.scope === 'selection') {
    throw new Error('selection scope does not require expanded-context authorization')
  }
  if (expansion.snapshotId !== snapshot.id || expansion.revision !== snapshot.revision) {
    throw new Error('expanded context no longer matches the visible selection')
  }

  const context = contextForScope(expansion.scope, expansion.context)
  return freezeMaterial({
    ...materialFromSnapshot(snapshot),
    authorizedScope: expansion.scope,
    actualScope: expansion.scope,
    completeness: expansion.completeness ?? 'complete',
    truncated: expansion.truncated ?? false,
    context,
  })
}

/** Default request authorization remains the exact fixed selection. */
export function defaultAuthorizedMaterial(snapshot: SelectionSnapshot): SelectionMaterial {
  return materialFromSnapshot(snapshot)
}

/** Authorization is bound to one immutable snapshot revision. */
export function isAuthorizationCurrent(
  material: SelectionMaterial | null,
  snapshot: SelectionSnapshot | null,
): material is SelectionMaterial {
  return material !== null
    && snapshot !== null
    && material.snapshotId === snapshot.id
    && material.revision === snapshot.revision
}

function contextForScope(
  scope: ExpandableAuthorizationScope,
  context: SelectionExpansion['context'],
): SelectionMaterial['context'] {
  switch (scope) {
    case 'local':
      return {
        ...(context.before === undefined ? {} : { before: context.before }),
        ...(context.after === undefined ? {} : { after: context.after }),
      }
    case 'section':
      return context.sectionText === undefined ? {} : { sectionText: context.sectionText }
    case 'page':
      return context.pageText === undefined ? {} : { pageText: context.pageText }
  }
}

/**
 * Browser-safe projection of a snapshot already validated at the Native IPC
 * boundary. The host validates this material again before durable persistence;
 * keeping the projection here prevents the WebView from importing host-only
 * Agent and model packages.
 */
function materialFromSnapshot(snapshot: SelectionSnapshot): SelectionMaterial {
  if (snapshot.selection.text.trim().length === 0) {
    throw new Error('selection.text must not be blank')
  }
  return freezeMaterial({
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    capturedAt: snapshot.capturedAt,
    selection: {
      text: snapshot.selection.text,
      ...(snapshot.selection.language === undefined ? {} : { language: snapshot.selection.language }),
    },
    source: {
      kind: snapshot.source.kind,
      ...(snapshot.source.app === undefined ? {} : { app: snapshot.source.app }),
      ...(snapshot.source.process === undefined ? {} : { process: snapshot.source.process }),
      ...(snapshot.source.windowTitle === undefined ? {} : { windowTitle: snapshot.source.windowTitle }),
    },
    ...(snapshot.document === undefined ? {} : {
      document: {
        ...(snapshot.document.title === undefined ? {} : { title: snapshot.document.title }),
        ...(snapshot.document.url === undefined ? {} : { url: snapshot.document.url }),
        ...(snapshot.document.section === undefined ? {} : { section: snapshot.document.section }),
        ...(snapshot.document.frameUrl === undefined ? {} : { frameUrl: snapshot.document.frameUrl }),
      },
    }),
    authorizedScope: 'selection',
    actualScope: 'selection',
    completeness: 'complete',
  })
}

function freezeMaterial(material: SelectionMaterial): SelectionMaterial {
  const freeze = (value: unknown): void => {
    if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
  }
  freeze(material)
  return material
}
