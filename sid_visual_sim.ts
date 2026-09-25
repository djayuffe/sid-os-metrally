import * as THREE from 'three';

const DIE_V_SHADER = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vStress;
varying float vContention;
varying float vHeat;
varying float vAge;
varying float vPhase;

uniform sampler2D uFieldTex;
uniform sampler2D uStressTex;
uniform sampler2D uThermalTex;
uniform sampler2D uAgingTex;
uniform float uTime;

void main() {
    vUv = uv;
    vec4 field = texture2D(uFieldTex, uv);
    vec4 stressData = texture2D(uStressTex, uv);
    vec4 thermal = texture2D(uThermalTex, uv);
    vec4 aging = texture2D(uAgingTex, uv);

    vStress = stressData.r;
    vContention = stressData.g;
    vHeat = thermal.r;
    vAge = aging.r;
    vPhase = field.a;

    float energy = length(field.rgb) * 0.045;

    vec3 pos = position;
    // CYCLE-CORRECT PHYSICAL VIBRATION
    float jitter = (energy + vContention * 0.001) * sin(uv.x * 70.0 + uv.y * 40.0 + uTime * 60.0 + vPhase * 12.0);
    pos.z += energy * 0.4 + jitter;

    vNormal = normalize(normalMatrix * normal);
    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const DIE_F_SHADER = `
uniform sampler2D uFieldTex;
uniform sampler2D uStressTex;
uniform sampler2D uThermalTex;
uniform sampler2D uAgingTex;
uniform float uTime;

uniform float uPotentialScale;
uniform float uCurrentScale;
uniform float uThermalScale;
uniform float uBreakdownScale;
uniform float uHazeScale;
uniform float uSparkScale;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vStress;
varying float vContention;
varying float vHeat;
varying float vAge;
varying float vPhase;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash(i + vec2(0,0)), hash(i + vec2(1,0)), u.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}

void main() {
    vec4 spectralField = texture2D(uFieldTex, vUv);

    // MICRO-TRACE ETCHING (CYCLE STABLE)
    float trace1 = step(0.85, noise(vUv * 500.0)) * 0.06;
    float trace2 = step(0.9, noise(vUv * vec2(1200.0, 50.0))) * 0.03;
    float grid = step(0.98, fract(vUv.x * 1024.0)) * 0.05 + step(0.98, fract(vUv.y * 512.0)) * 0.02;

    vec3 siliconBase = vec3(0.008, 0.012, 0.03) + trace1 + trace2 + grid;

    // SPECTRAL LOGIC FLOW (linked to cycle-correct hue)
    vec3 spectral = spectralField.rgb * uPotentialScale * 2.0;

    // REAL FIGHT FILTER: Hot contention white-out on circuit traces
    float fightJitter = step(0.5, noise(vUv * 2000.0 + uTime * 30.0));
    vec3 logicFight = vec3(1.0, 0.99, 0.95) * pow(vContention, 4.0) * 60.0 * fightJitter * uBreakdownScale;

    // BREAKDOWN MOIRE (Phase-locked chaos)
    float moire = sin(vUv.x * 2000.0 * vPhase) * cos(vUv.y * 2000.0 * vPhase);
    vec3 breakdown = vec3(0.9, 1.0, 1.0) * max(0.0, moire) * vStress * 3.0 * uBreakdownScale;

    // THERMAL ENERGY (Anti-blowout clamping)
    vec3 thermal = vec3(1.0, 0.2, 0.0) * vHeat * 2.5 * uThermalScale;

    // OXIDATION AGING
    vec3 haze = vec3(0.2, 0.2, 0.8) * vAge * 0.4 * uHazeScale;

    // MICRO-DISCHARGES
    float sparkTrigger = step(0.999, fract(sin(vUv.x * 300.0 + vUv.y * 20.0 + uTime * 80.0))) * (vStress + vContention * 4.0);
    vec3 sparkCol = vec3(1.0, 1.0, 1.0) * sparkTrigger * 100.0 * uSparkScale;

    vec3 final = siliconBase + spectral + thermal + breakdown + logicFight + haze + sparkCol;

    // STABLE HDR TONEMAPPING
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(0.0, dot(vNormal, viewDir)), 3.0);
    final += (spectral * 0.5 + vec3(0.1, 0.2, 0.4)) * fresnel * (1.5 + vHeat);

    // FILMIC SOFT-SATURATION
    final = final / (vec3(1.1) + final);
    gl_FragColor = vec4(final, 1.0);
}
`;

const FILAMENT_V_SHADER = `
varying float vLife;
varying vec3 vColor;
uniform sampler2D uArcBuffer;
uniform float uTime;

void main() {
    vec4 arc = texture2D(uArcBuffer, vec2(float(gl_InstanceID) / 128.0, 0.5));
    vLife = arc.r;
    vColor = vec3(0.5, 0.8, 1.0);
    vec3 pos = position;
    float seed = float(gl_InstanceID);
    // Plasma filament oscillation
    pos.x += sin(uTime * 300.0 + seed) * 0.003 * vLife;
    pos.z += cos(uTime * 350.0 + seed) * 0.003 * vLife;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
}
`;

const FILAMENT_F_SHADER = `
varying float vLife;
varying vec3 vColor;
void main() {
    if(vLife < 0.003) discard;
    vec3 col = mix(vColor, vec3(1.0), vLife * 0.95);
    gl_FragColor = vec4(col * vLife * 20.0, 1.0);
}
`;

export function buildPhotonicSid(params: { model: string, accent: THREE.Color }) {
    const group = new THREE.Group();
    const L = 0.0386, W = 0.014, H = 0.0039;

    const packageMat = new THREE.MeshPhysicalMaterial({
        color: 0x010101,
        roughness: 0.98,
        metalness: 0.8,
        clearcoat: 1.0,
        clearcoatRoughness: 0.01
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), packageMat);
    body.position.y = H/2;
    group.add(body);

    const dieMat = new THREE.ShaderMaterial({
        vertexShader: DIE_V_SHADER,
        fragmentShader: DIE_F_SHADER,
        uniforms: {
            uFieldTex: { value: null },
            uStressTex: { value: null },
            uThermalTex: { value: null },
            uAgingTex: { value: null },
            uTime: { value: 0 },
            uPotentialScale: { value: 1.0 },
            uCurrentScale: { value: 1.0 },
            uThermalScale: { value: 1.0 },
            uBreakdownScale: { value: 1.0 },
            uHazeScale: { value: 1.0 },
            uSparkScale: { value: 1.0 }
        },
        transparent: true
    });
    const die = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.9, W * 0.97, 256, 128), dieMat);
    die.rotation.x = -Math.PI / 2;
    die.position.y = H + 0.0001;
    group.add(die);

    const arcMat = new THREE.ShaderMaterial({
        vertexShader: FILAMENT_V_SHADER,
        fragmentShader: FILAMENT_F_SHADER,
        uniforms: { uArcBuffer: { value: null }, uTime: { value: 0 } },
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
    });
    const arcGeo = new THREE.CylinderGeometry(0.00002, 0.00005, L * 0.95, 4, 1);
    const filaments = new THREE.InstancedMesh(arcGeo, arcMat, 128);
    filaments.position.y = H + 0.005;
    group.add(filaments);

    (group as any).tick = (dt: number, time: number,
        state: THREE.Texture,
        field: THREE.Texture,
        stress: THREE.Texture,
        arcs: THREE.Texture,
        thermal: THREE.Texture,
        aging: THREE.Texture,
        regs: number[],
        gfxParams?: any) => {

        dieMat.uniforms.uFieldTex.value = field;
        dieMat.uniforms.uStressTex.value = stress;
        dieMat.uniforms.uThermalTex.value = thermal;
        dieMat.uniforms.uAgingTex.value = aging;
        dieMat.uniforms.uTime.value = time;

        if (gfxParams) {
            dieMat.uniforms.uPotentialScale.value = gfxParams.potential ?? 1.0;
            dieMat.uniforms.uCurrentScale.value = gfxParams.current ?? 1.0;
            dieMat.uniforms.uThermalScale.value = gfxParams.thermal ?? 1.0;
            dieMat.uniforms.uBreakdownScale.value = gfxParams.breakdown ?? 1.0;
            dieMat.uniforms.uHazeScale.value = gfxParams.haze ?? 1.0;
            dieMat.uniforms.uSparkScale.value = gfxParams.sparks ?? 1.0;
        }

        arcMat.uniforms.uArcBuffer.value = arcs;
        arcMat.uniforms.uTime.value = time;

        const matrix = new THREE.Matrix4();
        for(let i=0; i<128; i++) {
            matrix.makeTranslation((Math.random()-0.5)*0.038, 0, (Math.random()-0.5)*0.014);
            filaments.setMatrixAt(i, matrix);
        }
        filaments.instanceMatrix.needsUpdate = true;
    };

    return group;
}
