import * as THREE from 'three';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  MOS_CORE_HYPERVISOR_V12 (STABLE_HDR_PHYSICS)               ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║ Cycle-Correct GPGPU Silicon Pipeline:                       ║
 * ║ • CORE_LOGIC    : Sub-cycle phase & freq integration        ║
 * ║ • REAL_FIGHT    : logic-collision gradient analysis          ║
 * ║ • THERMAL_FLUX  : Joule heating with safe dissipation       ║
 * ║ • EMI_SPECTRAL  : Hue-mapped energy fields                  ║
 * ║ • STABILITY     : Safe-saturation clamping (Anti-Blowout)   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

export class SidGpuEngine {
    private renderer: THREE.WebGLRenderer;
    private scene: THREE.Scene;
    private camera: THREE.OrthographicCamera;

    public decodedTarget: THREE.WebGLRenderTarget;
    public stateTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
    public thermalTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
    public fieldTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
    public stressTarget: THREE.WebGLRenderTarget;
    public agingTarget: THREE.WebGLRenderTarget;
    public arcTarget: THREE.WebGLRenderTarget;

    private decodeMat: THREE.ShaderMaterial;
    private stateMat: THREE.ShaderMaterial;
    private thermalMat: THREE.ShaderMaterial;
    private fieldMat: THREE.ShaderMaterial;
    private stressMat: THREE.ShaderMaterial;
    private agingMat: THREE.ShaderMaterial;
    private arcMat: THREE.ShaderMaterial;

    private regTexture: THREE.DataTexture;
    private currentIdx: number = 0;
    private quad: THREE.Mesh;

    constructor(renderer: THREE.WebGLRenderer) {
        this.renderer = renderer;
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        const opts = {
            format: THREE.RGBAFormat,
            type: THREE.FloatType,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter
        };

        this.decodedTarget = new THREE.WebGLRenderTarget(32, 1, opts);
        this.stateTargets = [new THREE.WebGLRenderTarget(32, 8, opts), new THREE.WebGLRenderTarget(32, 8, opts)];
        this.thermalTargets = [new THREE.WebGLRenderTarget(256, 256, opts), new THREE.WebGLRenderTarget(256, 256, opts)];
        this.fieldTargets = [new THREE.WebGLRenderTarget(512, 512, opts), new THREE.WebGLRenderTarget(512, 512, opts)];
        this.stressTarget = new THREE.WebGLRenderTarget(256, 256, opts);
        this.agingTarget = new THREE.WebGLRenderTarget(256, 256, opts);
        this.arcTarget = new THREE.WebGLRenderTarget(128, 1, opts);

        this.regTexture = new THREE.DataTexture(new Float32Array(32 * 4), 32, 1, THREE.RGBAFormat, THREE.FloatType);

        this.decodeMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: { uRegs: { value: this.regTexture } },
            vertexShader: `void main() { gl_Position = vec4(position, 1.0); }`,
            fragmentShader: `
                precision highp float;
                uniform sampler2D uRegs;
                out vec4 outColor;
                void main() {
                    ivec2 t = ivec2(gl_FragCoord.xy);
                    vec4 r = texelFetch(uRegs, t, 0);
                    outColor = vec4(r.r / 255.0, r.g / 255.0, r.b / 255.0, 1.0);
                }
            `
        });

        this.stateMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: { uDec: { value: null }, uPrev: { value: null }, uDt: { value: 0 }, uTime: { value: 0 } },
            vertexShader: `void main() { gl_Position = vec4(position, 1.0); }`,
            fragmentShader: `
                precision highp float;
                uniform sampler2D uDec;
                uniform sampler2D uPrev;
                uniform float uDt;
                uniform float uTime;
                out vec4 outColor;

                void main() {
                    ivec2 t = ivec2(gl_FragCoord.xy);
                    vec4 prev = texelFetch(uPrev, t, 0);
                    vec4 res = prev;

                    if (t.y == 0) {
                        int v = t.x / 7;
                        if (v < 3) {
                            float f0 = texelFetch(uDec, ivec2(v*7, 0), 0).r * 255.0;
                            float f1 = texelFetch(uDec, ivec2(v*7+1, 0), 0).r * 255.0;
                            float freq = f0 + f1 * 256.0;
                            float inc = (freq * 985248.0 * uDt) / 16777216.0;
                            res.r = fract(prev.r + inc);
                            res.g = freq / 16384.0;
                            res.b = texelFetch(uDec, ivec2(v*7+5, 0), 0).r;
                            res.a = texelFetch(uDec, ivec2(v*7+6, 0), 0).r;
                        }
                    }
                    outColor = res;
                }
            `
        });

        this.thermalMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: { uState: { value: null }, uPrevThermal: { value: null }, uDt: { value: 0 } },
            vertexShader: `out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
            fragmentShader: `
                precision highp float;
                uniform sampler2D uState;
                uniform sampler2D uPrevThermal;
                uniform float uDt;
                in vec2 vUv;
                out vec4 outColor;
                void main() {
                    vec2 e = 1.0 / 256.0 * vec2(1.0, 0.0);
                    float t0 = texture(uPrevThermal, vUv).r;
                    float t1 = texture(uPrevThermal, vUv + e.xy).r;
                    float t2 = texture(uPrevThermal, vUv - e.xy).r;
                    float t3 = texture(uPrevThermal, vUv + e.yx).r;
                    float t4 = texture(uPrevThermal, vUv - e.yx).r;

                    float diff = (t1 + t2 + t3 + t4) * 0.25 - t0;
                    float heat = 0.0;

                    for(int i=0; i<3; i++) {
                        vec4 s = texture(uState, vec2(float(i*7)/32.0, 0.125));
                        float d = length(vUv - vec2(0.3 + float(i)*0.2, 0.5)) - 0.15;
                        if(d < 0.0) heat += s.b * 0.12;
                    }

                    // Clamped thermal flow - STABLE_DECAY
                    float res = t0 + diff * 0.4 + heat * uDt * 6.0 - 0.0003;
                    outColor = vec4(clamp(res, 0.0, 4.0), 0.0, 0.0, 1.0);
                }
            `
        });

        this.fieldMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: { uState: { value: null }, uPrevField: { value: null }, uThermal: { value: null }, uTime: { value: 0 }, uDt: { value: 0 } },
            vertexShader: `out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
            fragmentShader: `
                precision highp float;
                uniform sampler2D uState;
                uniform sampler2D uPrevField;
                uniform sampler2D uThermal;
                uniform float uTime;
                uniform float uDt;
                in vec2 vUv;
                out vec4 outColor;

                vec3 hsv2rgb(vec3 c) {
                    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
                    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
                }

                void main() {
                    vec4 field = texture(uPrevField, vUv);
                    float heat = texture(uThermal, vUv).r;
                    vec2 p = vUv * 2.0 - 1.0;

                    for(int i=0; i<3; i++) {
                        vec4 s = texture(uState, vec2(float(i*7)/32.0, 0.125));
                        vec3 voiceColor = hsv2rgb(vec3(s.g * 2.8, 0.85, 1.0));

                        // Jitter nodes tightly bound to phase (R channel)
                        vec2 nodePos = vec2(-0.75 + float(i)*0.75, sin(uTime * 5.0 + s.r * 15.0) * (0.05 + heat * 0.05));
                        float d = length(p - nodePos) - 0.15;
                        if(d < 0.0) {
                            float energy = s.b * (1.0 - abs(d)*7.0);
                            field.rgb += voiceColor * energy * 3.0;
                            field.a = mix(field.a, s.r, 0.1); // Stable phase blending
                        }
                    }

                    // Anti-blowout decay
                    field.rgb *= (0.88 - heat * 0.03);
                    outColor = clamp(field, 0.0, 30.0);
                }
            `
        });

        this.agingMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: { uThermal: { value: null }, uPrevAging: { value: null }, uDt: { value: 0 } },
            vertexShader: `out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
            fragmentShader: `
                precision highp float;
                uniform sampler2D uThermal;
                uniform sampler2D uPrevAging;
                uniform float uDt;
                in vec2 vUv;
                out vec4 outColor;
                void main() {
                    float t = texture(uThermal, vUv).r;
                    float age = texture(uPrevAging, vUv).r;
                    float damage = (t * t * 0.00008) * uDt * 30.0;
                    outColor = vec4(clamp(age + damage, 0.0, 1.0), 0.0, 0.0, 1.0);
                }
            `
        });

        this.stressMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: { uField: { value: null }, uAging: { value: null } },
            vertexShader: `out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
            fragmentShader: `
                precision highp float;
                uniform sampler2D uField;
                uniform sampler2D uAging;
                in vec2 vUv;
                out vec4 outColor;
                void main() {
                    vec2 e = vec2(1.0/512.0, 0.0);
                    vec4 f = texture(uField, vUv);
                    vec4 fx = texture(uField, vUv + e.xy);
                    vec4 fy = texture(uField, vUv + e.yx);
                    float age = texture(uAging, vUv).r;

                    // REAL FIGHT: Transistor contention analysis
                    // Collision detected where multiple spectral bands overlap at high energy
                    float contention = length(f.rg) * length(f.gb) * 2.0;
                    float grad = length(fx.rgb - f.rgb) + length(fy.rgb - f.rgb);
                    float fight = contention + grad * 0.15;

                    float stress = (grad + fight) * (1.0 + age * 10.0);
                    outColor = vec4(stress, fight, age, 1.0);
                }
            `
        });

        this.arcMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: { uStress: { value: null }, uTime: { value: 0 } },
            vertexShader: `void main() { gl_Position = vec4(position, 1.0); }`,
            fragmentShader: `
                precision highp float;
                uniform sampler2D uStress;
                uniform float uTime;
                out vec4 outColor;
                void main() {
                    float id = gl_FragCoord.x / 128.0;
                    vec4 s = texture(uStress, vec2(id, fract(uTime * 0.03)));
                    // High-trigger threshold for micro-plasma spikes
                    float trigger = step(0.85, (s.r + s.g) * fract(sin(id * 66.0 + uTime) * 55.0));
                    outColor = vec4(s.r * trigger * 20.0, s.g * trigger * 12.0, trigger, 1.0);
                }
            `
        });

        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
        this.scene.add(this.quad);
    }

    public step(dt: number, time: number, regs: number[]) {
        // High frequency cycle-link: map registers to input texture
        const data = new Float32Array(32 * 4);
        for (let i = 0; i < 32; i++) { data[i * 4] = regs[i] || 0; }
        this.regTexture.image.data = data;
        this.regTexture.needsUpdate = true;

        const nextIdx = 1 - this.currentIdx;

        const passes = [
            { mat: this.decodeMat, target: this.decodedTarget, inputs: {} },
            { mat: this.stateMat, target: this.stateTargets[nextIdx], inputs: { uDec: this.decodedTarget.texture, uPrev: this.stateTargets[this.currentIdx].texture, uDt: dt, uTime: time } },
            { mat: this.thermalMat, target: this.thermalTargets[nextIdx], inputs: { uState: this.stateTargets[nextIdx].texture, uPrevThermal: this.thermalTargets[this.currentIdx].texture, uDt: dt } },
            { mat: this.fieldMat, target: this.fieldTargets[nextIdx], inputs: { uState: this.stateTargets[nextIdx].texture, uPrevField: this.fieldTargets[this.currentIdx].texture, uThermal: this.thermalTargets[nextIdx].texture, uTime: time, uDt: dt } },
            { mat: this.agingMat, target: this.agingTarget, inputs: { uThermal: this.thermalTargets[nextIdx].texture, uPrevAging: this.agingTarget.texture, uDt: dt } },
            { mat: this.stressMat, target: this.stressTarget, inputs: { uField: this.fieldTargets[nextIdx].texture, uAging: this.agingTarget.texture } },
            { mat: this.arcMat, target: this.arcTarget, inputs: { uStress: this.stressTarget.texture, uTime: time } }
        ];

        passes.forEach(p => {
            this.quad.material = p.mat;
            Object.entries(p.inputs).forEach(([k, v]) => { p.mat.uniforms[k].value = v; });
            this.renderer.setRenderTarget(p.target);
            this.renderer.render(this.scene, this.camera);
        });

        this.renderer.setRenderTarget(null);
        this.currentIdx = nextIdx;
    }

    public get state() { return this.stateTargets[this.currentIdx].texture; }
    public get thermal() { return this.thermalTargets[this.currentIdx].texture; }
    public get field() { return this.fieldTargets[this.currentIdx].texture; }
    public get stress() { return this.stressTarget.texture; }
    public get arcs() { return this.arcTarget.texture; }
    public get aging() { return this.agingTarget.texture; }

    public dispose() {
        this.decodedTarget.dispose();
        this.stateTargets.forEach(t => t.dispose());
        this.thermalTargets.forEach(t => t.dispose());
        this.fieldTargets.forEach(t => t.dispose());
        this.stressTarget.dispose();
        this.agingTarget.dispose();
        this.arcTarget.dispose();
        this.regTexture.dispose();
    }
}
