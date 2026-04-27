export type CanonicalSignalAction = 'BUY' | 'SELL' | 'HOLD';
export type ExtendedSignalAction =
  | CanonicalSignalAction
  | 'SHORT'
  | 'COVER';
export type SignalMode = 'long_only' | 'long_short';

export interface ActionPositionState {
  longShares: number;
  shortShares: number;
}

export interface NormalizedActionResult {
  rawAction: ExtendedSignalAction;
  normalizedAction: ExtendedSignalAction;
  canonicalAction: CanonicalSignalAction;
  note: string;
}

function toExtendedAction(rawAction: string): ExtendedSignalAction {
  const normalized = rawAction.trim().toUpperCase();
  if (
    normalized === 'BUY' ||
    normalized === 'SELL' ||
    normalized === 'HOLD' ||
    normalized === 'SHORT' ||
    normalized === 'COVER'
  ) {
    return normalized;
  }
  return 'HOLD';
}

export function normalizeActionForMode(
  rawActionInput: string,
  mode: SignalMode,
  positionState: ActionPositionState,
): NormalizedActionResult {
  const rawAction = toExtendedAction(rawActionInput);
  if (mode === 'long_short') {
    if (rawAction === 'COVER' && positionState.shortShares <= 0) {
      return {
        rawAction,
        normalizedAction: 'HOLD',
        canonicalAction: 'HOLD',
        note: 'COVER ignored: no short position',
      };
    }
    return {
      rawAction,
      normalizedAction: rawAction,
      canonicalAction:
        rawAction === 'SHORT' || rawAction === 'COVER' ? 'HOLD' : rawAction,
      note: '',
    };
  }

  if (rawAction === 'COVER') {
    return {
      rawAction,
      normalizedAction: 'HOLD',
      canonicalAction: 'HOLD',
      note: 'COVER mapped to HOLD in long-only mode',
    };
  }
  if (rawAction === 'SHORT') {
    return {
      rawAction,
      normalizedAction: 'HOLD',
      canonicalAction: 'HOLD',
      note: 'SHORT mapped to HOLD in long-only mode',
    };
  }
  if (rawAction === 'SELL' && positionState.longShares <= 0) {
    return {
      rawAction,
      normalizedAction: 'HOLD',
      canonicalAction: 'HOLD',
      note: 'SELL ignored: no long position',
    };
  }

  return {
    rawAction,
    normalizedAction: rawAction,
    canonicalAction: rawAction,
    note: '',
  };
}
