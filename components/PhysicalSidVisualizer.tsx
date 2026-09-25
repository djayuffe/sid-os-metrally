import React, { useEffect, useRef, memo, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Activity, Zap, Thermometer, ShieldCheck, Sliders, Maximize2, Radio, Info } from 'lucide-react';
import { SidPlayer } from '../services/sidService';
import { SidGpuEngine } from '../sid_gpu_engine';
import { buildPhotonicSid } from '../sid_visual_sim';
import { showWebGLFallback, supportsWebGL } from '../services/webglFallback';

// =============================================================================
// CONSTANTS
// =============================================================================

const CAMERA_CONFIG = {
  FOV: 28,
  NEAR: 0.001,
  FAR: 10,
  POSITION: new THREE.Vector3(0.14, 0.1, 0.14),
  TARGET: new THREE.Vector3(0, 0.003, 0)
} as const;

const LIGHTING_CONFIG = {
  SUN_INTENSITY: 3.8,
  SUN_POSITION: new THREE.Vector3(0.4, 0.8, 0.4),
  FILL_INTENSITY: 1.8,
  FILL_POSITION: new THREE.Vector3(-0.25, 0.15, -0.25),
  FILL_DISTANCE: 1.2,
  AMBIENT_INTENSITY: 0.9
} as const;

const RENDERER_CONFIG = {
  TONE_MAPPING_EXPOSURE: 2.0,
  BLOOM_RADIUS: 1.6,
  BLOOM_THRESHOLD: 0.6
} as const;

const ANIMATION_CONFIG = {
  MAX_DELTA: 0.033,
  IDLE_ROTATION_SPEED: 0.0015,
  IDLE_BOB_SPEED: 1.2,
  IDLE_BOB_AMPLITUDE: 0.001,
  ACTIVE_BOB_SPEED: 160,
  ACTIVE_BOB_AMPLITUDE: 0.0008,
  ACTIVE_TILT_SPEED: 120,
  ACTIVE_TILT_AMPLITUDE: 0.006,
  IDLE_FILL_INTENSITY: 0.9
} as const;

const DEFAULT_GFX: GfxConfig = {
  bloom: 2.8,
  jitter: 0.85,
  potential: 1.1,
  current: 1.0,
  thermal: 1.2,
  breakdown: 1.4,
  haze: 0.9,
  sparks: 1.1
} as const;

// =============================================================================
// TYPES
// =============================================================================

interface PhysicalSidProps {
  player: SidPlayer | null;
  isPlaying: boolean;
  model: '6581' | '8580';
}

interface GfxConfig {
  bloom: number;
  jitter: number;
  potential: number;
  current: number;
  thermal: number;
  breakdown: number;
  haze: number;
  sparks: number;
}

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

interface PhotonicSidObject extends THREE.Group {
  tick: (
    dt: number,
    time: number,
    state: any,
    field: any,
    stress: any,
    arcs: any,
    thermal: any,
    aging: any,
    regs: number[],
    gfx: GfxConfig
  ) => void;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const lerp = (a: number, b: number, t: number): number => {
  return a + (b - a) * clamp(t, 0, 1);
};

// =============================================================================
// COMPONENTS
// =============================================================================

const SliderField: React.FC<SliderFieldProps> = memo(({
  label,
  value,
  min,
  max,
  step,
  onChange
}) => {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseFloat(e.target.value));
  }, [onChange]);

  const displayValue = useMemo(() => value.toFixed(2), [value]);

  return (
    <div className="flex flex-col gap-1 w-full group/slider">
      <div className="flex justify-between items-center px-0.5">
        <label className="text-[6px] font-black text-slate-500 uppercase tracking-widest group-hover/slider:text-slate-300 transition-colors">
          {label}
        </label>
        <span className="text-[6px] font-mono text-cyan-600" aria-live="polite">
          {displayValue}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        aria-label={`${label} control`}
        className="w-full h-0.5 bg-slate-900 appearance-none accent-cyan-500 cursor-crosshair focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-slate-950"
      />
    </div>
  );
});

SliderField.displayName = 'SliderField';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const PhysicalSidVisualizer: React.FC<PhysicalSidProps> = memo(({
  player,
  isPlaying,
  model
}) => {
  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SidGpuEngine | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  const sidRef = useRef<PhotonicSidObject | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const fillLightRef = useRef<THREE.PointLight | null>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // State
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [gfx, setGfx] = useState<GfxConfig>(DEFAULT_GFX);

  // Handlers
  const handleFullscreenChange = useCallback(() => {
    setIsFullscreen(!!document.fullscreenElement);
  }, []);

  const updateGfx = useCallback((key: keyof GfxConfig, value: number) => {
    setGfx(prev => ({ ...prev, [key]: value }));
  }, []);

  const requestFullscreen = useCallback(() => {
    containerRef.current?.requestFullscreen().catch(err => {
      console.warn('Fullscreen request failed:', err);
    });
  }, []);

  // Fullscreen listener
  useEffect(() => {
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [handleFullscreenChange]);

  // Main Three.js scene setup
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!supportsWebGL(canvas)) return showWebGLFallback(container, canvas, 'PHYSICAL SID VISUALIZER');

    let mounted = true;

    // Scene setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      CAMERA_CONFIG.FOV,
      1,
      CAMERA_CONFIG.NEAR,
      CAMERA_CONFIG.FAR
    );
    camera.position.copy(CAMERA_CONFIG.POSITION);
    cameraRef.current = camera;

    // Renderer setup
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
      });
    } catch {
      return showWebGLFallback(container, canvas, 'PHYSICAL SID VISUALIZER');
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = RENDERER_CONFIG.TONE_MAPPING_EXPOSURE;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;

    // Engine setup
    const engine = new SidGpuEngine(renderer);
    engineRef.current = engine;

    // Post-processing setup
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      gfx.bloom,
      RENDERER_CONFIG.BLOOM_RADIUS,
      RENDERER_CONFIG.BLOOM_THRESHOLD
    );
    composer.addPass(bloom);
    composerRef.current = composer;
    bloomPassRef.current = bloom;

    // Controls setup
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 0.04;
    controls.target.copy(CAMERA_CONFIG.TARGET);
    controlsRef.current = controls;

    // Lighting setup
    const sun = new THREE.DirectionalLight(0xffffff, LIGHTING_CONFIG.SUN_INTENSITY);
    sun.position.copy(LIGHTING_CONFIG.SUN_POSITION);
    scene.add(sun);

    const fill = new THREE.PointLight(
      0x00f2ff,
      LIGHTING_CONFIG.FILL_INTENSITY,
      LIGHTING_CONFIG.FILL_DISTANCE
    );
    fill.position.copy(LIGHTING_CONFIG.FILL_POSITION);
    scene.add(fill);
    fillLightRef.current = fill;

    scene.add(new THREE.AmbientLight(0x0a0a15, LIGHTING_CONFIG.AMBIENT_INTENSITY));

    // SID object setup
    try {
      const sid = buildPhotonicSid({
        model,
        accent: new THREE.Color(0x00f2ff)
      }) as PhotonicSidObject;
      scene.add(sid);
      sidRef.current = sid;
    } catch (error) {
      console.error('Failed to build photonic SID:', error);
    }

    // Resize handler
    const handleResize = () => {
      if (!containerRef.current || !mounted) return;

      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;

      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);
    handleResize();

    // Animation loop
    const animate = (time: number) => {
      if (!mounted) return;

      const timeSec = time / 1000;
      const deltaTime = Math.min(timeSec - lastTimeRef.current, ANIMATION_CONFIG.MAX_DELTA);
      lastTimeRef.current = timeSec;

      // Get register state
      const registers = player?.volatileRegs ?? new Array(32).fill(0);

      // Update engine
      if (engineRef.current) {
        engineRef.current.step(deltaTime, timeSec, registers);
      }

      // Update bloom
      if (bloomPassRef.current) {
        bloomPassRef.current.strength = gfx.bloom;
      }

      // Update SID object
      if (sidRef.current && engineRef.current) {
        try {
          sidRef.current.tick(
            deltaTime,
            timeSec,
            engineRef.current.state,
            engineRef.current.field,
            engineRef.current.stress,
            engineRef.current.arcs,
            engineRef.current.thermal,
            engineRef.current.aging,
            registers,
            gfx
          );

          if (isPlaying) {
            // Calculate energy from voice envelope levels
            const env0 = (registers[0x06] & 0xFF) / 255;
            const env1 = (registers[0x0D] & 0xFF) / 255;
            const env2 = (registers[0x14] & 0xFF) / 255;
            const avgEnergy = (env0 + env1 + env2) / 3;
            const energy = clamp(avgEnergy * gfx.jitter, 0, 1);

            // Animate SID die
            sidRef.current.position.y =
              Math.sin(timeSec * ANIMATION_CONFIG.ACTIVE_BOB_SPEED) *
              ANIMATION_CONFIG.ACTIVE_BOB_AMPLITUDE *
              energy;

            sidRef.current.rotation.z =
              Math.cos(timeSec * ANIMATION_CONFIG.ACTIVE_TILT_SPEED) *
              ANIMATION_CONFIG.ACTIVE_TILT_AMPLITUDE;

            // Animate fill light
            if (fillLightRef.current) {
              const baseIntensity = LIGHTING_CONFIG.FILL_INTENSITY;
              const variation = Math.random() * 3.0 * energy;
              fillLightRef.current.intensity = baseIntensity + variation;

              const freq = (registers[1] << 8) | registers[0];
              const hue = ((freq / 16384) * 2.2) % 1.0;
              fillLightRef.current.color.setHSL(hue, 0.7, 0.5);
            }
          } else {
            // Idle animation
            sidRef.current.rotation.y += ANIMATION_CONFIG.IDLE_ROTATION_SPEED;
            sidRef.current.position.y =
              Math.sin(timeSec * ANIMATION_CONFIG.IDLE_BOB_SPEED) *
              ANIMATION_CONFIG.IDLE_BOB_AMPLITUDE;

            if (fillLightRef.current) {
              fillLightRef.current.intensity = ANIMATION_CONFIG.IDLE_FILL_INTENSITY;
              fillLightRef.current.color.setHex(0x00f2ff);
            }
          }
        } catch (error) {
          console.error('Error updating SID object:', error);
        }
      }

      // Update controls
      if (controlsRef.current) {
        controlsRef.current.update();
      }

      // Render
      if (composerRef.current) {
        composerRef.current.render();
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    // Cleanup
    return () => {
      mounted = false;
      cancelAnimationFrame(rafRef.current);
      resizeObserver.disconnect();

      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }

      if (controlsRef.current) {
        controlsRef.current.dispose();
        controlsRef.current = null;
      }

      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }

      sceneRef.current = null;
      cameraRef.current = null;
      composerRef.current = null;
      bloomPassRef.current = null;
      sidRef.current = null;
      fillLightRef.current = null;
    };
  }, [player, model, isPlaying, gfx]);

  // Memoized progress calculation
  const telemetryProgress = useMemo(() => {
    return isPlaying ? 99 : 10;
  }, [isPlaying]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-black relative rounded-xl overflow-hidden silicon-border shadow-extreme group"
      role="region"
      aria-label="Physical SID Visualizer"
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block cursor-crosshair"
        aria-label="3D SID chip visualization"
      />

      {/* HUD SYSTEM */}
      <div className="absolute top-6 left-6 z-10 pointer-events-none flex flex-col gap-4">
        <div className="flex items-center gap-5">
          <div
            className="w-4 h-4 rounded-full bg-cyan-500 animate-pulse shadow-[0_0_50px_rgba(34,211,238,1)] border-2 border-white/20"
            role="status"
            aria-label={isPlaying ? 'Active' : 'Idle'}
          />
          <span className="text-[14px] font-black text-white tracking-[0.5em] uppercase hdr-glow">
            PHOTONIC_DIE_V11
          </span>
        </div>

        {!isFullscreen && (
          <div className="flex flex-col gap-2 pl-12 opacity-60">
            <div className="flex items-center gap-2">
              <Radio
                className="w-3 h-3 text-cyan-400 animate-spin-slow"
                aria-hidden="true"
              />
              <span className="text-[7px] text-slate-400 uppercase tracking-widest font-black">
                LITHOGRAPHY_LOCKED_SYNC
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-3 h-3 text-amber-500" aria-hidden="true" />
              <span className="text-[7px] text-slate-400 uppercase tracking-widest font-black">
                STABILITY_HYPERVISOR_ACTIVE
              </span>
            </div>
          </div>
        )}
      </div>

      {/* PARAMETER CONTROL HUD */}
      {!isFullscreen && (
        <div className="absolute top-6 right-6 z-20 w-44 flex flex-col gap-4 p-5 bg-black/70 backdrop-blur-2xl border border-white/5 rounded-2xl opacity-0 group-hover:opacity-100 transition-all duration-500 translate-x-4 group-hover:translate-x-0 shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-1">
            <div className="flex items-center gap-2">
              <Sliders className="w-3 h-3 text-cyan-400" aria-hidden="true" />
              <span className="text-[8px] font-black text-white tracking-widest uppercase">
                CORE_TUNER
              </span>
            </div>
            <Info className="w-2.5 h-2.5 text-slate-600" aria-hidden="true" />
          </div>

          <SliderField
            label="HDR_BLOOM"
            value={gfx.bloom}
            min={0}
            max={10}
            step={0.1}
            onChange={(v) => updateGfx('bloom', v)}
          />
          <SliderField
            label="DIE_JITTER"
            value={gfx.jitter}
            min={0}
            max={2.5}
            step={0.05}
            onChange={(v) => updateGfx('jitter', v)}
          />
          <SliderField
            label="SPECTRAL_W"
            value={gfx.potential}
            min={0}
            max={4.0}
            step={0.01}
            onChange={(v) => updateGfx('potential', v)}
          />
          <SliderField
            label="FLOW_RATE"
            value={gfx.current}
            min={0}
            max={3.0}
            step={0.01}
            onChange={(v) => updateGfx('current', v)}
          />
          <SliderField
            label="THERMAL_G"
            value={gfx.thermal}
            min={0}
            max={5.0}
            step={0.1}
            onChange={(v) => updateGfx('thermal', v)}
          />
          <SliderField
            label="FIGHT_LVL"
            value={gfx.breakdown}
            min={0}
            max={4.5}
            step={0.01}
            onChange={(v) => updateGfx('breakdown', v)}
          />
          <SliderField
            label="HAZE_OXID"
            value={gfx.haze}
            min={0}
            max={3.0}
            step={0.01}
            onChange={(v) => updateGfx('haze', v)}
          />
          <SliderField
            label="ARC_STRESS"
            value={gfx.sparks}
            min={0}
            max={6.0}
            step={0.1}
            onChange={(v) => updateGfx('sparks', v)}
          />

          <div className="mt-2 pt-3 border-t border-white/10 flex justify-center">
            <button
              onClick={requestFullscreen}
              className="flex items-center gap-3 px-4 py-1.5 bg-cyan-500/10 border border-cyan-500/30 rounded-xl hover:bg-cyan-500/30 transition-all group/fs shadow-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-slate-950"
              aria-label="Enter fullscreen mode"
            >
              <span className="text-[8px] font-black text-cyan-400 group-hover/fs:text-white uppercase tracking-widest">
                FS_MODE
              </span>
              <Maximize2 className="w-3 h-3 text-cyan-500 group-hover/fs:text-white" />
            </button>
          </div>
        </div>
      )}

      {/* LINK STATUS BAR */}
      <div className="absolute bottom-8 right-8 pointer-events-none flex flex-col items-end gap-3">
        <div className="flex items-center gap-4">
          <Activity className="w-4 h-4 text-cyan-500" aria-hidden="true" />
          <span className="text-[8px] text-slate-400 uppercase tracking-[0.5em] font-black italic">
            DIE_SPECTRAL_TELEMETRY_LINK
          </span>
        </div>
        <div
          className="w-64 h-1 bg-slate-900 rounded-full overflow-hidden border border-white/5 relative"
          role="progressbar"
          aria-valuenow={telemetryProgress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Telemetry signal strength"
        >
          <div className="absolute inset-0 bg-white/5 animate-pulse" />
          <div
            className={`h-full bg-gradient-to-r from-indigo-700 via-cyan-400 to-emerald-400 shadow-[0_0_25px_cyan] transition-all duration-500 ${
              isPlaying ? 'opacity-100' : 'opacity-20'
            }`}
            style={{ width: `${telemetryProgress}%` }}
          />
        </div>
      </div>

      {/* CINEMATIC VIGNETTE */}
      <div
        className="absolute inset-0 pointer-events-none shadow-[inset_0_0_200px_rgba(0,0,0,1)] bg-[radial-gradient(circle_at_center,transparent_30%,rgba(0,0,0,0.8)_100%)]"
        aria-hidden="true"
      />
    </div>
  );
});

PhysicalSidVisualizer.displayName = 'PhysicalSidVisualizer';

export default PhysicalSidVisualizer;
