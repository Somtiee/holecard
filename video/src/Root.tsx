import '../../src/ui/styles.css';
import './lib/video.css';
import './lib/theme';
import React from 'react';
import { AbsoluteFill, Audio, Composition, Sequence, staticFile } from 'remotion';
import { LEN, MAIN_FRAMES, SCENES, START, type SceneId } from './timeline';
import { LayoutCtx } from './ui/Shot';
import { Close, Cover, Hook } from './scenes/Opening';
import { SCENE_MAP } from './scenes';
import { VERTICAL, VERTICAL_FRAMES } from './scenes/Vertical';

const MAIN: Partial<Record<SceneId, React.FC>> = { cover: Cover, hook: Hook, close: Close, ...SCENE_MAP };

const Main: React.FC<{ audio?: boolean }> = ({ audio = true }) => (
  <LayoutCtx.Provider value="h">
    <AbsoluteFill style={{ background: '#ebebeb' }}>
      {SCENES.map(s => {
        const Scene = MAIN[s.id];
        return (
          <Sequence key={s.id} from={START[s.id]} durationInFrames={LEN[s.id]} name={s.id}>
            {Scene ? <Scene /> : <AbsoluteFill style={{ background: '#ddd', font: '600 60px sans-serif', padding: 80 }}>{s.id}</AbsoluteFill>}
          </Sequence>
        );
      })}
      {audio && <Audio src={staticFile('audio/main.wav')} />}
    </AbsoluteFill>
  </LayoutCtx.Provider>
);

const Vertical: React.FC<{ audio?: boolean }> = ({ audio = true }) => (
  <LayoutCtx.Provider value="v">
    <AbsoluteFill style={{ background: '#ebebeb' }}>
      {VERTICAL.map(s => (
        <Sequence key={s.id} from={s.from} durationInFrames={s.len} name={s.id}>
          <s.C />
        </Sequence>
      ))}
      {audio && <Audio src={staticFile('audio/vertical.wav')} />}
    </AbsoluteFill>
  </LayoutCtx.Provider>
);

export const Root: React.FC = () => (
  <>
    <Composition id="Main" component={Main} durationInFrames={MAIN_FRAMES} fps={30} width={1920} height={1080} defaultProps={{ audio: true }} />
    <Composition id="Vertical" component={Vertical} durationInFrames={VERTICAL_FRAMES} fps={30} width={1080} height={1920} defaultProps={{ audio: true }} />
  </>
);
