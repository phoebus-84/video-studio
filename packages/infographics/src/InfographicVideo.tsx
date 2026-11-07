import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  Series,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type {InfographicImage, InfographicItem, InfographicScene, InfographicSpec} from './schema.js';

const sans = 'Arial, Helvetica, sans-serif';
const mono = '"Courier New", Courier, monospace';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const toneColor = (tone: InfographicItem['tone'], p: InfographicSpec['palette']) => ({
  primary: p.primary,
  secondary: p.secondary,
  accent: p.accent,
  muted: p.muted,
})[tone];

/**
 * Image layer for a scene. The `src` is expected to be a self-contained data
 * URI so the spec renders deterministically without a local file dependency.
 */
const ImageLayer: React.FC<{image: InfographicImage; scene: InfographicScene}> = ({image, scene}) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 14], [0, 1], clamp);
  const fadeOut = interpolate(frame, [scene.durationInFrames - 14, scene.durationInFrames], [1, 0], clamp);
  const opacity = image.opacity * Math.min(fadeIn, fadeOut);

  if (image.position === 'background') {
    return <AbsoluteFill style={{opacity}}>
      <Img src={image.src} style={{
        width: '100%',
        height: '100%',
        objectFit: image.fit,
        filter: 'brightness(0.55) saturate(0.85)',
      }}/>
      <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(13,11,22,0.55) 0%, rgba(13,11,22,0.12) 45%, rgba(13,11,22,0.72) 100%)'}}/>
    </AbsoluteFill>;
  }

  const sideStyle: React.CSSProperties = image.position === 'right'
    ? {right: 64, top: 150, bottom: 140}
    : {left: 64, top: 150, bottom: 140};
  return <div style={{position: 'absolute', width: '38%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18, opacity, ...sideStyle}}>
    <div style={{borderRadius: 24, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.22)', boxShadow: '0 30px 90px rgba(0,0,0,0.55)'}}>
      <Img src={image.src} style={{width: '100%', height: '100%', objectFit: image.fit, display: 'block'}}/>
    </div>
    {image.caption ? <div style={{fontFamily: mono, fontSize: 15, color: '#b7b5c9', textAlign: 'center'}}>{image.caption}</div> : null}
  </div>;
};

const Envelope: React.FC<{color: string; size?: number}> = ({color, size = 132}) => (
  <div style={{
    width: size,
    height: size * 0.66,
    border: `${Math.max(3, size * 0.035)}px solid ${color}`,
    borderRadius: size * 0.08,
    position: 'relative',
    boxSizing: 'border-box',
  }}>
    <div style={{
      position: 'absolute',
      width: size * 0.59,
      height: size * 0.59,
      borderLeft: `${Math.max(3, size * 0.035)}px solid ${color}`,
      borderBottom: `${Math.max(3, size * 0.035)}px solid ${color}`,
      transform: 'rotate(-45deg)',
      left: size * 0.17,
      top: -size * 0.32,
    }} />
  </div>
);

const LockIcon: React.FC<{color: string; size?: number}> = ({color, size = 150}) => (
  <div style={{width: size, height: size, position: 'relative'}}>
    <div style={{
      width: size * 0.55,
      height: size * 0.42,
      border: `${Math.max(4, size * 0.045)}px solid ${color}`,
      borderRadius: size * 0.14,
      margin: '0 auto',
      boxSizing: 'border-box',
    }}/>
    <div style={{
      position: 'absolute',
      left: size * 0.225,
      top: size * 0.24,
      width: size * 0.55,
      height: size * 0.30,
      border: `${Math.max(4, size * 0.045)}px solid ${color}`,
      borderRadius: '50%',
      borderBottom: 'none',
      boxSizing: 'border-box',
    }}/>
  </div>
);

const Background: React.FC<{spec: InfographicSpec}> = ({spec}) => {
  const frame = useCurrentFrame();
  const drift = frame % 120;
  return <AbsoluteFill style={{
    backgroundColor: spec.palette.ink,
    backgroundImage: `linear-gradient(${spec.palette.primary}1a 1px, transparent 1px), linear-gradient(90deg, ${spec.palette.primary}1a 1px, transparent 1px), radial-gradient(circle at 84% 14%, ${spec.palette.primary}55 0, transparent 31%), radial-gradient(circle at 5% 93%, ${spec.palette.secondary}44 0, transparent 35%)`,
    backgroundSize: '72px 72px, 72px 72px, 100% 100%, 100% 100%',
    backgroundPosition: `${drift * 0.12}px ${drift * 0.12}px`,
  }}>
    <AbsoluteFill style={{
      opacity: 0.22,
      backgroundImage: 'repeating-linear-gradient(0deg, transparent 0px, transparent 3px, rgba(255,255,255,0.045) 4px)',
    }} />
  </AbsoluteFill>;
};

const SceneChrome: React.FC<{
  spec: InfographicSpec;
  scene: InfographicScene;
  index: number;
  children: React.ReactNode;
}> = ({spec, scene, index, children}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, 12, scene.durationInFrames - 12, scene.durationInFrames],
    [0, 1, 1, 0],
    clamp,
  );
  return <AbsoluteFill style={{opacity, color: spec.palette.paper, fontFamily: sans}}>
    <Background spec={spec} />
    <div style={{position: 'absolute', top: 42, left: 64, right: 64, display: 'flex', alignItems: 'center', gap: 18}}>
      <div style={{fontFamily: mono, fontSize: 18, color: spec.palette.accent, letterSpacing: 3}}>
        {spec.brandEyebrow ?? ''}
      </div>
      <div style={{height: 1, flex: 1, background: `${spec.palette.paper}33`}} />
      <div style={{fontFamily: mono, fontSize: 17, color: spec.palette.muted}}>
        {String(index + 1).padStart(2, '0')} — {String(spec.scenes.length).padStart(2, '0')}
      </div>
    </div>
    {children}
    <div style={{position: 'absolute', left: 64, bottom: 42, fontFamily: mono, fontSize: 16, color: `${spec.palette.paper}77`}}>
      {spec.brandFooter ?? ''}
    </div>
  </AbsoluteFill>;
};

const Heading: React.FC<{scene: InfographicScene; accent: string; maxWidth?: number}> = ({scene, accent, maxWidth = 1540}) => {
  const frame = useCurrentFrame();
  const rise = interpolate(frame, [0, 22], [45, 0], {...clamp, easing: Easing.out(Easing.cubic)});
  return <div style={{transform: `translateY(${rise}px)`, maxWidth}}>
    {scene.eyebrow ? <div style={{fontFamily: mono, color: accent, fontWeight: 700, fontSize: 22, letterSpacing: 4, textTransform: 'uppercase', marginBottom: 18}}>{scene.eyebrow}</div> : null}
    <div style={{fontSize: 76, fontWeight: 800, lineHeight: 0.98, letterSpacing: -3}}>{scene.title}</div>
    {scene.subtitle ? <div style={{fontSize: 28, lineHeight: 1.35, color: '#cbc9df', maxWidth: 1100, marginTop: 24}}>{scene.subtitle}</div> : null}
  </div>;
};

const ItemCard: React.FC<{item: InfographicItem; spec: InfographicSpec; index: number; compact?: boolean}> = ({item, spec, index, compact}) => {
  const frame = useCurrentFrame();
  const entrance = spring({frame: frame - index * 7 - 12, fps: spec.fps, config: {damping: 18, stiffness: 130}});
  return <div style={{
    opacity: entrance,
    transform: `translateY(${(1 - entrance) * 30}px)`,
    border: `1px solid ${toneColor(item.tone, spec.palette)}88`,
    borderTop: `6px solid ${toneColor(item.tone, spec.palette)}`,
    borderRadius: 18,
    padding: compact ? '20px 24px' : '28px 30px',
    background: `${spec.palette.paper}0d`,
    minHeight: compact ? 90 : 125,
    boxSizing: 'border-box',
  }}>
    {item.tag ? <div style={{fontFamily: mono, fontSize: 15, color: toneColor(item.tone, spec.palette), marginBottom: 10, letterSpacing: 2}}>{item.tag}</div> : null}
    <div style={{fontWeight: 800, fontSize: compact ? 25 : 31, lineHeight: 1.05}}>{item.label}</div>
    {item.detail ? <div style={{fontSize: compact ? 18 : 21, lineHeight: 1.3, color: '#b7b5c9', marginTop: 10}}>{item.detail}</div> : null}
  </div>;
};

const TitleScene: React.FC<{spec: InfographicSpec; scene: InfographicScene}> = ({spec, scene}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pop = spring({frame, fps, config: {damping: 14, stiffness: 95}});
  const mailX = interpolate(frame, [0, 45], [-520, 0], {...clamp, easing: Easing.out(Easing.exp)});
  const splitTitle = scene.title.split('\n');
  return <>
    <div style={{position: 'absolute', inset: '170px 110px 120px 110px', display: 'grid', gridTemplateColumns: '1.45fr 0.55fr', alignItems: 'center', gap: 80}}>
      <div>
        <div style={{fontFamily: mono, fontSize: 23, color: spec.palette.accent, letterSpacing: 5, marginBottom: 30}}>{scene.eyebrow?.toUpperCase() ?? 'NO-CODE CRYPTOGRAPHY'}</div>
        <div style={{fontSize: 146, lineHeight: 0.84, fontWeight: 900, letterSpacing: -9, transform: `scale(${0.85 + pop * 0.15})`, transformOrigin: 'left center'}}>
          {splitTitle.map((line, i) => (
            <div key={i} style={{color: i === splitTitle.length - 1 ? spec.palette.accent : undefined}}>{line}</div>
          ))}
        </div>
        <div style={{marginTop: 48, fontSize: 31, lineHeight: 1.35, color: '#d3d1e5', maxWidth: 880}}>{scene.subtitle}</div>
      </div>
      <div style={{position: 'relative', height: 500, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        {[0, 1, 2, 3].map((n) => <div key={n} style={{position: 'absolute', width: 420 + n * 90, height: 420 + n * 90, borderRadius: '50%', border: `1px solid ${spec.palette.primary}${n === 0 ? 'cc' : '44'}`, transform: `scale(${0.8 + pop * 0.2})`}} />)}
        <div style={{transform: `translateX(${mailX}px) rotate(-8deg)`, filter: `drop-shadow(0 20px 42px ${spec.palette.accent}55)`}}><LockIcon color={spec.palette.accent} size={170}/></div>
      </div>
    </div>
  </>;
};

const ComparisonScene: React.FC<{spec: InfographicSpec; scene: InfographicScene}> = ({spec, scene}) => {
  const frame = useCurrentFrame();
  const split = interpolate(frame, [10, 40], [0.5, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  const midpoint = Math.ceil(scene.items.length / 2);
  const sideA = scene.items.slice(0, midpoint);
  const sideB = scene.items.slice(midpoint);
  const labelA = sideA[0]?.tag ?? 'THEIRS';
  const labelB = sideB[0]?.tag ?? 'OURS';
  return <div style={{position: 'absolute', inset: '130px 90px 100px'}}>
    <Heading scene={scene} accent={spec.palette.accent}/>
    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, marginTop: 45, transform: `scaleX(${split})`}}>
      <div style={{borderRadius: 26, padding: 30, background: '#151323', border: `1px solid ${spec.palette.muted}55`}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22}}>
          <span style={{fontFamily: mono, fontSize: 20, color: spec.palette.muted}}>BEFORE / RENTED</span>
          <span style={{fontSize: 15, border: `1px solid ${spec.palette.muted}`, borderRadius: 20, padding: '7px 12px', color: spec.palette.muted}}>{labelA}</span>
        </div>
        <div style={{display: 'grid', gap: 15}}>{sideA.map((item, i) => <ItemCard key={item.label} item={item} spec={spec} index={i} compact/>)}</div>
      </div>
      <div style={{borderRadius: 26, padding: 30, background: `${spec.palette.primary}20`, border: `1px solid ${spec.palette.accent}99`, boxShadow: `0 0 70px ${spec.palette.primary}22`}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22}}>
          <span style={{fontFamily: mono, fontSize: 20, color: spec.palette.accent}}>AFTER / ZENROOM</span>
          <span style={{fontSize: 15, border: `1px solid ${spec.palette.accent}`, borderRadius: 20, padding: '7px 12px', color: spec.palette.accent}}>{labelB}</span>
        </div>
        <div style={{display: 'grid', gap: 15}}>{sideB.map((item, i) => <ItemCard key={item.label} item={item} spec={spec} index={i + midpoint} compact/>)}</div>
      </div>
    </div>
  </div>;
};

const OrbitScene: React.FC<{spec: InfographicSpec; scene: InfographicScene}> = ({spec, scene}) => {
  const frame = useCurrentFrame();
  const cx = 960;
  const cy = 580;
  const radiusX = 610;
  const radiusY = 285;
  return <div style={{position: 'absolute', inset: '125px 60px 100px'}}>
    <Heading scene={scene} accent={spec.palette.accent} maxWidth={950}/>
    <svg width="100%" height="690" style={{position: 'absolute', left: 0, top: 75, overflow: 'visible'}}>
      <ellipse cx={cx - 60} cy={cy - 75} rx={radiusX} ry={radiusY} fill="none" stroke={`${spec.palette.primary}66`} strokeWidth="2" strokeDasharray="8 12"/>
      {scene.items.map((_, i) => {
        const angle = (Math.PI * 2 * i / scene.items.length) - Math.PI / 2;
        const x = cx - 60 + Math.cos(angle) * radiusX;
        const y = cy - 75 + Math.sin(angle) * radiusY;
        return <line key={i} x1={cx - 60} y1={cy - 75} x2={x} y2={y} stroke={`${spec.palette.primary}55`} strokeWidth="2"/>;
      })}
    </svg>
    <div style={{position: 'absolute', width: 260, height: 150, borderRadius: 26, left: cx - 130 - 60, top: cy - 75, transform: 'translateY(-50%)', background: spec.palette.accent, color: spec.palette.ink, display: 'grid', placeItems: 'center', boxShadow: `0 0 80px ${spec.palette.accent}55`}}>
      <div style={{textAlign: 'center'}}><div style={{fontFamily: mono, fontSize: 43, fontWeight: 900}}>zenroom</div><div style={{fontFamily: mono, fontSize: 18}}>crypto VM</div></div>
    </div>
    {scene.items.map((item, i) => {
      const angle = (Math.PI * 2 * i / scene.items.length) - Math.PI / 2;
      const x = cx - 60 + Math.cos(angle) * radiusX;
      const y = cy - 75 + Math.sin(angle) * radiusY;
      const entrance = spring({frame: frame - i * 10 - 20, fps: spec.fps, config: {damping: 16}});
      return <div key={item.label} style={{position: 'absolute', left: x - 115, top: y - 50, width: 230, height: 100, opacity: entrance, transform: `scale(${0.7 + entrance * 0.3})`, borderRadius: 16, border: `1px solid ${toneColor(item.tone, spec.palette)}`, background: '#171527', display: 'grid', placeItems: 'center', textAlign: 'center', boxShadow: '0 15px 40px #0007'}}>
        <div><div style={{fontFamily: mono, fontSize: 23, fontWeight: 700}}>{item.label}</div><div style={{fontSize: 15, color: '#9e9caf', marginTop: 5}}>{item.detail}</div></div>
      </div>;
    })}
    <div style={{position: 'absolute', bottom: -10, left: 210, right: 210, borderRadius: 17, background: spec.palette.primary, padding: '20px 30px', fontFamily: mono, fontSize: 24, textAlign: 'center'}}>{scene.footer}</div>
  </div>;
};

const CommandsScene: React.FC<{spec: InfographicSpec; scene: InfographicScene}> = ({spec, scene}) => {
  const frame = useCurrentFrame();
  const active = Math.floor(frame / 90) % Math.max(scene.items.length, 1);
  return <div style={{position: 'absolute', inset: '125px 80px 95px'}}>
    <Heading scene={scene} accent={spec.palette.accent}/>
    <div style={{display: 'grid', gridTemplateColumns: '1.05fr 0.95fr', gap: 34, marginTop: 44, height: 570}}>
      <div style={{border: `1px solid ${spec.palette.primary}99`, background: '#09090d', borderRadius: 24, overflow: 'hidden', boxShadow: '0 25px 80px #0008'}}>
        <div style={{height: 54, background: '#171620', display: 'flex', alignItems: 'center', padding: '0 22px', gap: 10}}>
          {[spec.palette.accent, spec.palette.secondary, spec.palette.primary].map((c) => <div key={c} style={{width: 13, height: 13, background: c, borderRadius: '50%'}}/>)}
          <span style={{fontFamily: mono, color: '#777587', marginLeft: 14}}>~/crypto — zenroom</span>
        </div>
        <div style={{padding: 34, fontFamily: mono, fontSize: 25, lineHeight: 1.7}}>
          <div><span style={{color: spec.palette.accent}}>λ</span> zenroom <span style={{color: spec.palette.muted}}>-z</span></div>
          <div style={{color: '#777587', margin: '12px 0 18px'}}>usage: zenroom [-k keys] [-a data] -z contract.zen</div>
          {scene.items.map((item, i) => <div key={item.label} style={{display: 'grid', gridTemplateColumns: '155px 1fr', color: i === active ? spec.palette.paper : '#777587', background: i === active ? `${spec.palette.primary}55` : 'transparent', padding: '4px 12px', borderRadius: 8}}>
            <span style={{color: i === active ? spec.palette.accent : spec.palette.muted}}>{item.label}</span><span>{item.detail}</span>
          </div>)}
          <div style={{marginTop: 18}}><span style={{color: spec.palette.accent}}>λ</span> <span style={{opacity: frame % 30 < 16 ? 1 : 0}}>▋</span></div>
        </div>
      </div>
      <div style={{display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18}}>
        <div style={{fontFamily: mono, fontSize: 18, color: spec.palette.muted}}>DISPATCH MODEL</div>
        {scene.items.slice(0, 5).map((item, i) => <div key={item.label} style={{borderRadius: 15, background: i === active ? spec.palette.accent : `${spec.palette.primary}25`, color: i === active ? spec.palette.ink : spec.palette.paper, border: `1px solid ${i === active ? spec.palette.accent : `${spec.palette.primary}77`}`, padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', transform: `translateX(${i === active ? -14 : 0}px)`}}>
          <span style={{fontFamily: mono, fontSize: 24, fontWeight: 800}}>zenroom {item.label}</span><span style={{fontFamily: mono, fontSize: 20}}>→ {item.tag}</span>
        </div>)}
        {scene.metric ? <div style={{marginTop: 12, display: 'flex', alignItems: 'baseline', gap: 16}}><span style={{fontSize: 64, fontWeight: 900, color: spec.palette.accent}}>{scene.metric.value}</span><span style={{fontSize: 20, color: spec.palette.muted}}>{scene.metric.label}</span></div> : null}
      </div>
    </div>
  </div>;
};

const PipelineScene: React.FC<{spec: InfographicSpec; scene: InfographicScene}> = ({spec, scene}) => {
  const frame = useCurrentFrame();
  const active = Math.floor(frame / 110) % Math.max(scene.items.length, 1);
  return <div style={{position: 'absolute', inset: '125px 80px 90px'}}>
    <Heading scene={scene} accent={spec.palette.accent}/>
    <div style={{marginTop: 58, display: 'grid', gap: 22}}>
      {scene.items.map((item, i) => {
        const progress = interpolate(frame - i * 18, [0, 35], [0, 1], clamp);
        const selected = i === active;
        return <div key={item.label} style={{display: 'grid', gridTemplateColumns: '90px 330px 1fr 170px', alignItems: 'center', gap: 22, opacity: 0.42 + progress * 0.58}}>
          <div style={{fontFamily: mono, fontSize: 18, color: selected ? spec.palette.accent : spec.palette.muted}}>0{i + 1}</div>
          <div style={{fontSize: 31, fontWeight: 800}}>{item.label}</div>
          <div style={{height: 12, borderRadius: 12, background: `${spec.palette.paper}12`, overflow: 'hidden'}}><div style={{height: '100%', width: `${selected ? 100 : 36 + i * 12}%`, background: toneColor(item.tone, spec.palette), borderRadius: 12, transition: 'none'}}/></div>
          <div style={{fontFamily: mono, fontSize: 17, color: toneColor(item.tone, spec.palette), textAlign: 'right'}}>{item.tag}</div>
          <div/><div/><div style={{fontSize: 19, color: '#a8a6ba', marginTop: -14}}>{item.detail}</div><div/>
        </div>;
      })}
    </div>
    {scene.metric ? <div style={{position: 'absolute', right: 10, bottom: 20, textAlign: 'right'}}><div style={{fontSize: 92, fontWeight: 900, color: spec.palette.accent, lineHeight: 0.9}}>{scene.metric.value}</div><div style={{fontFamily: mono, fontSize: 18, color: spec.palette.muted, marginTop: 14}}>{scene.metric.label}</div></div> : null}
  </div>;
};

const TimelineScene: React.FC<{spec: InfographicSpec; scene: InfographicScene}> = ({spec, scene}) => {
  const frame = useCurrentFrame();
  const stepDuration = scene.durationInFrames / Math.max(scene.items.length, 1);
  const active = Math.min(scene.items.length - 1, Math.floor(frame / stepDuration));
  const pathProgress = interpolate(frame, [10, scene.durationInFrames - 25], [0, 1], clamp);
  return <div style={{position: 'absolute', inset: '125px 80px 90px'}}>
    <Heading scene={scene} accent={spec.palette.accent}/>
    <div style={{position: 'relative', marginTop: 100, padding: '0 45px'}}>
      <div style={{position: 'absolute', left: 100, right: 100, top: 44, height: 4, background: `${spec.palette.paper}22`}}/>
      <div style={{position: 'absolute', left: 100, top: 44, height: 4, width: `calc((100% - 200px) * ${pathProgress})`, background: spec.palette.accent, boxShadow: `0 0 20px ${spec.palette.accent}`}}/>
      <div style={{display: 'grid', gridTemplateColumns: `repeat(${scene.items.length}, 1fr)`, gap: 18}}>
        {scene.items.map((item, i) => <div key={item.label} style={{textAlign: 'center'}}>
          <div style={{width: 92, height: 92, margin: '0 auto', borderRadius: '50%', border: `3px solid ${i <= active ? spec.palette.accent : `${spec.palette.paper}33`}`, background: i === active ? spec.palette.accent : spec.palette.ink, color: i === active ? spec.palette.ink : spec.palette.paper, display: 'grid', placeItems: 'center', fontFamily: mono, fontWeight: 900, fontSize: 22, position: 'relative', boxShadow: i === active ? `0 0 50px ${spec.palette.accent}55` : 'none'}}>{String(i + 1).padStart(2, '0')}</div>
          <div style={{fontFamily: mono, fontWeight: 900, fontSize: 24, marginTop: 28, color: i === active ? spec.palette.accent : spec.palette.paper}}>{item.label}</div>
          <div style={{fontSize: 18, lineHeight: 1.3, color: '#9593a7', marginTop: 12, padding: '0 10px'}}>{item.detail}</div>
        </div>)}
      </div>
    </div>
    <div style={{position: 'absolute', left: 180, right: 180, bottom: 65, border: `1px solid ${spec.palette.primary}77`, background: '#09090dcc', borderRadius: 18, padding: '22px 30px', fontFamily: mono, fontSize: 22, display: 'flex', justifyContent: 'space-between'}}><span><span style={{color: spec.palette.accent}}>λ</span> zenroom {scene.items[active]?.label.toLowerCase()}</span><span style={{color: spec.palette.muted}}>{scene.items[active]?.tag}</span></div>
  </div>;
};

const FeatureScene: React.FC<{spec: InfographicSpec; scene: InfographicScene}> = ({spec, scene}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const slide = interpolate(frame, [8, 42], [120, 0], {...clamp, easing: Easing.out(Easing.cubic)});
  const kenBurns = interpolate(frame, [0, scene.durationInFrames], [1.06, 1.16], clamp);
  const kenX = interpolate(frame, [0, scene.durationInFrames], [-2.2, 2.2], clamp);
  const image = scene.image;
  return <div style={{position: 'absolute', inset: '130px 80px 90px', display: 'grid', gridTemplateColumns: '0.98fr 1.02fr', gap: 60, alignItems: 'center'}}>
    <div style={{transform: `translateX(${slide}px)`}}>
      <Heading scene={scene} accent={spec.palette.accent}/>
      <div style={{display: 'grid', gap: 16, marginTop: 40}}>
        {scene.items.map((item, i) => {
          const entrance = spring({frame: frame - i * 8 - 22, fps, config: {damping: 17, stiffness: 120}});
          return <div key={item.label} style={{opacity: entrance, transform: `translateY(${(1 - entrance) * 26}px)`, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 18, alignItems: 'center', border: `1px solid ${toneColor(item.tone, spec.palette)}77`, borderLeft: `6px solid ${toneColor(item.tone, spec.palette)}`, borderRadius: 15, padding: '16px 22px', background: `${spec.palette.paper}0c`}}>
            <div style={{fontFamily: mono, fontSize: 16, color: toneColor(item.tone, spec.palette), fontWeight: 800, letterSpacing: 1}}>{item.tag}</div>
            <div>
              <div style={{fontWeight: 800, fontSize: 26}}>{item.label}</div>
              {item.detail ? <div style={{fontSize: 18, color: '#b7b5c9', marginTop: 3}}>{item.detail}</div> : null}
            </div>
          </div>;
        })}
      </div>
      {scene.footer ? <div style={{marginTop: 30, fontFamily: mono, fontSize: 18, color: spec.palette.accent}}>{scene.footer}</div> : null}
    </div>
    {image ? (
      <div style={{position: 'relative', height: 620, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{position: 'absolute', width: 560, height: 560, borderRadius: '50%', border: `1px solid ${spec.palette.primary}55`, transform: `scale(${1.02 + 0.05 * Math.sin(frame / 45)})`}} />
        <div style={{position: 'absolute', width: 640, height: 640, borderRadius: '50%', border: `1px solid ${spec.palette.primary}30`}} />
        <div style={{width: 560, height: 560, borderRadius: 34, overflow: 'hidden', border: `1px solid ${spec.palette.accent}aa`, boxShadow: `0 40px 120px ${spec.palette.accent}44, 0 0 0 10px ${spec.palette.ink}`}}>
          <Img src={image.src} style={{width: '100%', height: '100%', objectFit: image.fit, transform: `scale(${kenBurns}) translateX(${kenX}%)`, display: 'block'}}/>
          <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, padding: '30px 28px 22px', background: 'linear-gradient(180deg, transparent, rgba(13,11,22,0.88))'}}>
            <div style={{fontFamily: mono, fontSize: 18, color: spec.palette.accent, fontWeight: 800}}>{scene.eyebrow?.toUpperCase()}</div>
            {image.caption ? <div style={{fontSize: 19, color: '#d8d6e8', marginTop: 4}}>{image.caption}</div> : null}
          </div>
        </div>
      </div>
    ) : null}
  </div>;
};

const OutroScene: React.FC<{spec: InfographicSpec; scene: InfographicScene}> = ({spec, scene}) => {
  const frame = useCurrentFrame();
  const pop = spring({frame, fps: spec.fps, config: {damping: 14, stiffness: 90}});
  return <div style={{position: 'absolute', inset: '130px 90px 100px', display: 'grid', placeItems: 'center', textAlign: 'center'}}>
    <div style={{transform: `scale(${0.82 + pop * 0.18})`}}>
      <div style={{display: 'flex', justifyContent: 'center', marginBottom: 40}}><LockIcon color={spec.palette.accent} size={120}/></div>
      <div style={{fontFamily: mono, color: spec.palette.accent, letterSpacing: 5, fontSize: 21}}>{scene.eyebrow}</div>
      <div style={{fontSize: 118, fontWeight: 900, letterSpacing: -7, marginTop: 12}}>{scene.title}</div>
      <div style={{fontSize: 29, color: '#c2c0d2', marginTop: 22}}>{scene.subtitle}</div>
      <div style={{display: 'inline-block', marginTop: 52, borderRadius: 999, background: spec.palette.accent, color: spec.palette.ink, fontFamily: mono, fontWeight: 900, fontSize: 26, padding: '22px 38px'}}>{scene.footer}</div>
      {scene.items[0] ? <div style={{fontFamily: mono, color: spec.palette.muted, marginTop: 36, fontSize: 21}}>{scene.items[0].label}</div> : null}
    </div>
  </div>;
};

const Scene: React.FC<{spec: InfographicSpec; scene: InfographicScene}> = ({spec, scene}) => (
  <>
    {scene.image ? <ImageLayer image={scene.image} scene={scene}/> : null}
    {(() => {
      switch (scene.template) {
        case 'title': return <TitleScene spec={spec} scene={scene}/>;
        case 'comparison': return <ComparisonScene spec={spec} scene={scene}/>;
        case 'orbit': return <OrbitScene spec={spec} scene={scene}/>;
        case 'commands': return <CommandsScene spec={spec} scene={scene}/>;
        case 'pipeline': return <PipelineScene spec={spec} scene={scene}/>;
        case 'timeline': return <TimelineScene spec={spec} scene={scene}/>;
        case 'outro': return <OutroScene spec={spec} scene={scene}/>;
        case 'feature': return <FeatureScene spec={spec} scene={scene}/>;
      }
    })()}
  </>
);

export const InfographicVideo: React.FC<{spec: InfographicSpec}> = ({spec}) => (
  <AbsoluteFill style={{background: spec.palette.ink}}>
    <Series>
      {spec.scenes.map((scene, index) => (
        <Series.Sequence key={scene.id} durationInFrames={scene.durationInFrames}>
          <SceneChrome spec={spec} scene={scene} index={index}>
            <Scene spec={spec} scene={scene}/>
          </SceneChrome>
        </Series.Sequence>
      ))}
    </Series>
  </AbsoluteFill>
);
