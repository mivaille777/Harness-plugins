import type { SelectionSnapshot } from '../../src/context/snapshot.js'
import {
  normalizeSelectionMaterial,
  selectionMaterialFromSnapshot,
  type SelectionMaterial,
  type SelectionMaterialScope,
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
  return normalizeSelectionMaterial({
    ...selectionMaterialFromSnapshot(snapshot),
    authorizedScope: expansion.scope,
    actualScope: expansion.scope,
    completeness: expansion.completeness ?? 'complete',
    truncated: expansion.truncated ?? false,
    context,
  })
}

/** Default request authorization remains the exact fixed selection. */
export function defaultAuthorizedMaterial(snapshot: SelectionSnapshot): SelectionMaterial {
  return selectionMaterialFromSnapshot(snapshot)
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
