import { useCallback, useReducer } from 'react';
import type { CustomFont, Segment, Style, TemplateState, TextLayer } from '../types';

/** Everything undoable. */
export interface Doc {
  name: string;
  segments: Segment[];
  style: Style;
  presetId: string | null;
  tpl: TemplateState;
  texts: TextLayer[];
  fonts: CustomFont[];
}

interface HistoryState {
  past: Doc[];
  present: Doc;
  future: Doc[];
  lastKey: string | null;
  lastTime: number;
}

type Action =
  | { type: 'apply'; fn: (d: Doc) => Doc; key?: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; doc: Doc };

const LIMIT = 200;
/** Changes with the same key inside this window merge into one undo step (slider drags, typing). */
const COALESCE_MS = 800;

function reducer(state: HistoryState, action: Action): HistoryState {
  switch (action.type) {
    case 'apply': {
      const next = action.fn(state.present);
      if (next === state.present) return state;
      const now = Date.now();
      const merge = action.key != null && action.key === state.lastKey && now - state.lastTime < COALESCE_MS;
      return {
        past: merge ? state.past : [...state.past, state.present].slice(-LIMIT),
        present: next,
        future: [],
        lastKey: action.key ?? null,
        lastTime: now,
      };
    }
    case 'undo': {
      if (state.past.length === 0) return state;
      const prev = state.past[state.past.length - 1];
      return { past: state.past.slice(0, -1), present: prev, future: [state.present, ...state.future], lastKey: null, lastTime: 0 };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return { past: [...state.past, state.present], present: next, future: rest, lastKey: null, lastTime: 0 };
    }
    case 'reset':
      return { past: [], present: action.doc, future: [], lastKey: null, lastTime: 0 };
  }
}

export function useHistory(initial: Doc) {
  const [state, dispatch] = useReducer(reducer, initial, (doc) => ({ past: [], present: doc, future: [], lastKey: null, lastTime: 0 }));
  const apply = useCallback((fn: (d: Doc) => Doc, key?: string) => dispatch({ type: 'apply', fn, key }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const reset = useCallback((doc: Doc) => dispatch({ type: 'reset', doc }), []);
  return {
    doc: state.present,
    apply,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
