
import React, { useEffect, useRef, memo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SidPlayer } from '../services/sidService';
import { showWebGLFallback, supportsWebGL } from '../services/webglFallback';

/* =========================
   GPU DATA CHANNELS
   =========================
   Instead of `uniform float power[36]` (can break on some drivers / clone cost),
   we use a 36x1 DataTexture with R = power (0..1).
*/

const NMOS_HDR_VERTEX_SHADER = `
precision highp float;

varying vec3 vNormal;
varying vec3 vPosition;
varying float vPower;
varying float vHeat;

attribute float bitIdx;

uniform sampler2D uPowerTex; // 36x1, R = power
uniform float masterSag;
uniform float time;
uniform float dieTemp;

float fetchPower(float idx) {
  float u = (idx + 0.5) / 36.0;
  return texture2D(uPowerTex, vec2(u, 0.5)).r;
}

void main() {
  vNormal = normalize(normalMatrix * normal);

  float p = fetchPower(bitIdx);
  vPower = p;

  // dieTemp in °C
  vHeat = clamp((dieTemp - 25.0) / 75.0, 0.0, 1.0);

  vec3 pos = position;

  float swell = 1.0 + (p * 0.3) + (vHeat * 0.15);

  // Sidewalls swell more
  if (abs(normal.y) < 0.1) {
    pos.x *= swell;
    pos.z *= swell;
  }

  float jitter = sin(time * 150.0 + bitIdx) * p * 0.05 * (1.0 + vHeat);
  pos.x += jitter;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  vPosition = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const NMOS_HDR_FRAGMENT_SHADER = `
precision highp float;

varying vec3 vNormal;
varying vec3 vPosition;
varying float vPower;
varying float vHeat;

uniform vec3 baseColor;
uniform float time;
uniform float masterSag;

float getLightning(vec2 uv, float t, float seed) {
  float n = sin(uv.x * 10.0 + uv.y * 20.0 + t * 50.0 + seed);
  return pow(max(0.0, n), 20.0) * step(0.98, fract(sin(seed + t) * 43758.5));
}

vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
}

void main() {
  vec3 lightDir = normalize(vec3(5.0, 5.0, 10.0));
  float diff = max(dot(vNormal, lightDir), 0.0);

  float plasmaSpeed = 40.0 + vPower * 100.0;
  float plasma = 0.5 + 0.5 * sin(vPosition.y * 25.0 - time * plasmaSpeed);

  vec3 silicon = mix(baseColor * 0.2, vec3(0.05, 0.05, 0.1), 1.0 - diff);

  vec3 heatCol = mix(vec3(1.0, 0.1, 0.0), vec3(1.0, 0.8, 0.4), vHeat);

  float arc = getLightning(vPosition.xy, time, vPower * 10.0);
  vec3 arcCol = vec3(0.7, 0.9, 1.0) * arc * 15.0;

  float emissiveIntensity = vPower * (10.0 + vHeat * 30.0) * plasma;
  vec3 emissive = mix(baseColor, heatCol, vHeat) * emissiveIntensity;

  vec3 color = silicon + emissive + arcCol;

  // Fresnel-like edge glow
  float fresnel = pow(1.0 - max(0.0, dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 3.0);
  color += mix(baseColor, vec3(1.0), vHeat) * fresnel * vPower * 5.0;

  gl_FragColor = vec4(aces(color), 1.0);
}
`;

const RAIL_HDR_VERTEX_SHADER = `
precision highp float;

varying float vSag;
varying vec2 vUv;

uniform float masterSag;

void main() {
  vUv = uv;
  vSag = masterSag;

  vec3 pos = position;
  pos.y -= masterSag * 1.5 * sin(uv.x * 3.14159);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const RAIL_HDR_FRAGMENT_SHADER = `
precision highp float;

varying float vSag;
varying vec2 vUv;

uniform float time;

void main() {
  float flow = 0.5 + 0.5 * sin(vUv.x * 80.0 - time * 45.0);

  vec3 baseRail = vec3(0.0, 1.5, 2.0);
  vec3 sagRail  = vec3(3.0, 0.5, 0.0);

  vec3 col = mix(baseRail, sagRail, clamp(vSag, 0.0, 1.0));

  float spark = step(0.97, fract(sin(vUv.x * 123.4 + time * 10.0) * 4321.0)) * clamp(vSag, 0.0, 1.0);

  vec3 final = col * (0.4 + 0.6 * flow) + vec3(spark * 5.0);

  // Light tonemap
  vec3 outc = final / (vec3(1.0) + final);
  gl_FragColor = vec4(outc, 1.0);
}
`;

interface NmosProps {
  player: SidPlayer | null;
  isPlaying: boolean;
}

const NmosLogicVisualizer: React.FC<NmosProps> = memo(({ player, isPlaying }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Keep latest player in a ref to avoid re-init
  const playerRef = useRef<SidPlayer | null>(player);
  useEffect(() => { playerRef.current = player; }, [player]);

  // Power texture + backing buffer (36x1 RGBA8)
  const powerDataRef = useRef<Uint8Array | null>(null);
  const powerTexRef = useRef<THREE.DataTexture | null>(null);

  const startTime = useRef<number>(performance.now());

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    if (!supportsWebGL(canvas)) return showWebGLFallback(container, canvas, 'NMOS LOGIC VISUALIZER');

    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const getDpr = () => clamp(window.devicePixelRatio || 1, 1, 2);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(0, 0, 15);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
      });
    } catch {
      return showWebGLFallback(container, canvas, 'NMOS LOGIC VISUALIZER');
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 2;
    controls.maxDistance = 100;

    // Power texture init
    const powerData = new Uint8Array(36 * 4);
    for (let i = 0; i < 36; i++) {
      powerData[i * 4 + 0] = 0;   // R
      powerData[i * 4 + 1] = 0;   // G
      powerData[i * 4 + 2] = 0;   // B
      powerData[i * 4 + 3] = 255; // A
    }
    const powerTex = new THREE.DataTexture(powerData, 36, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    powerTex.minFilter = THREE.NearestFilter;
    powerTex.magFilter = THREE.NearestFilter;
    powerTex.wrapS = THREE.ClampToEdgeWrapping;
    powerTex.wrapT = THREE.ClampToEdgeWrapping;
    powerTex.flipY = false;
    powerTex.needsUpdate = true;

    powerDataRef.current = powerData;
    powerTexRef.current = powerTex;

    const colors = [new THREE.Color(0x00ffff), new THREE.Color(0xff00ff), new THREE.Color(0xffaa00)];

    const transistorMatBase = new THREE.ShaderMaterial({
      vertexShader: NMOS_HDR_VERTEX_SHADER,
      fragmentShader: NMOS_HDR_FRAGMENT_SHADER,
      uniforms: {
        uPowerTex: { value: powerTex },
        baseColor: { value: new THREE.Color(0x22d3ee) },
        masterSag: { value: 0 },
        time: { value: 0 },
        dieTemp: { value: 25.0 }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const transistors: THREE.Mesh[] = [];
    for (let v = 0; v < 3; v++) {
      for (let b = 0; b < 12; b++) {
        const idx = v * 12 + b;
        const geometry = new THREE.CylinderGeometry(0.25, 0.2, 1.2, 16, 8);
        const bitIdxArr = new Float32Array(geometry.attributes.position.count);
        bitIdxArr.fill(idx);
        geometry.setAttribute('bitIdx', new THREE.BufferAttribute(bitIdxArr, 1));

        const meshMat = transistorMatBase.clone();
        meshMat.uniforms = THREE.UniformsUtils.clone(transistorMatBase.uniforms);
        meshMat.uniforms.baseColor.value = colors[v];

        const mesh = new THREE.Mesh(geometry, meshMat);
        mesh.position.set((b - 5.5) * 1.1, (v - 1) * 4.0, 0);
        mesh.rotation.z = Math.PI / 2;

        scene.add(mesh);
        transistors.push(mesh);
      }
    }

    const railGeo = new THREE.BoxGeometry(14, 0.3, 0.3, 128, 1, 1);
    const railMat = new THREE.ShaderMaterial({
      vertexShader: RAIL_HDR_VERTEX_SHADER,
      fragmentShader: RAIL_HDR_FRAGMENT_SHADER,
      uniforms: {
        masterSag: { value: 0 },
        time: { value: 0 }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.y = 5.8;
    scene.add(rail);

    const handleResize = () => {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      renderer.setPixelRatio(getDpr());
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);
    handleResize();

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const elapsedTime = (performance.now() - startTime.current) / 1000.0;
      controls.update();

      const p = playerRef.current;
      const physics = p?.volatilePhysics ?? { temp: 25, power: 0.7, vSupply: 12.0 };
      const vStates: any[] = (p as any)?.volatileVoiceStates ?? [];

      for (let i = 0; i < 36; i++) powerData[i * 4 + 0] = 0;
      for (let vIdx = 0; vIdx < 3; vIdx++) {
        const vs = vStates[vIdx];
        const level = typeof vs?.level === 'number' ? clamp(vs.level, 0, 1) : 0;
        for (let b = 0; b < 12; b++) {
          const weight = b / 11.0;
          const val = level * (0.2 + weight * 0.8);
          powerData[(vIdx * 12 + b) * 4 + 0] = (clamp(val, 0, 1) * 255) | 0;
        }
      }
      powerTex.needsUpdate = true;

      const maxV = (p as any)?.lastClock === 985248 ? 12.0 : 9.0;
      const sag = clamp((maxV - physics.vSupply) / maxV, 0, 1);

      for (const mesh of transistors) {
        const mat = mesh.material as THREE.ShaderMaterial;
        mat.uniforms.masterSag.value = sag;
        mat.uniforms.time.value = elapsedTime;
        mat.uniforms.dieTemp.value = physics.temp;
      }
      (rail.material as THREE.ShaderMaterial).uniforms.masterSag.value = sag;
      (rail.material as THREE.ShaderMaterial).uniforms.time.value = elapsedTime;

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      for (const m of transistors) {
        (m.geometry as THREE.BufferGeometry).dispose();
        (m.material as THREE.ShaderMaterial).dispose();
      }
      railGeo.dispose();
      railMat.dispose();
      powerTex.dispose();
      renderer.dispose();
      try { (renderer as any).forceContextLoss?.(); } catch {}
    };
  }, []);

  const tempC = player?.volatilePhysics?.temp ?? 25;

  return (
    <div ref={containerRef} className="w-full h-full bg-[#010204] relative rounded-xl overflow-hidden silicon-border shadow-2xl">
      <canvas ref={canvasRef} className="w-full h-full block cursor-move" />
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-4 pointer-events-none">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_20px_red]" />
          <span className="text-[12px] font-black text-white tracking-[0.4em] uppercase glow-text">
            PHYSICS_COMPUTE_DIE_V1.2
          </span>
        </div>
      </div>
      <div className="absolute bottom-4 right-6 z-10 flex items-center gap-8 pointer-events-none">
        <div className="flex flex-col items-end">
          <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">JOULE_HEAT_INDEX</span>
          <span className={`text-xl font-black tracking-tighter ${tempC > 80 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
            {tempC.toFixed(1)}°C
          </span>
        </div>
      </div>
    </div>
  );
});

export default NmosLogicVisualizer;
