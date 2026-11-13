import type React from 'react';
import type { SceneId } from '../timeline';
import { Fund, Keys, SignIn, Withdraw } from './Agent';
import { Lock, Private, Result, Shuffle, Trophies } from './Match';
import { Practice } from './Practice';
import { Stack } from './Stack';
export const SCENE_MAP: Partial<Record<SceneId, React.FC>> = {
  practice: Practice,
  signin: SignIn,
  keys: Keys,
  fund: Fund,
  lock: Lock,
  shuffle: Shuffle,
  private: Private,
  result: Result,
  trophies: Trophies,
  withdraw: Withdraw,
  stack: () => <Stack />,
};
