import { HOLDING_PALETTE } from './position-bubbles.mjs';

export const SPRITE_RADIUS = 1.2;

const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  varying vec2 vUv;
  uniform vec3 uLight;
  uniform vec3 uCore;
  uniform vec3 uDeep;
  void main() {
    vec2 p = (vUv * 2.0 - 1.0) * ${SPRITE_RADIUS.toFixed(2)};
    float dist = length(p);
    float surface = 1.0 - smoothstep(0.989, 1.01, dist);
    vec3 n = vec3(p, sqrt(max(0.0, 1.0 - dot(p, p))));
    vec3 lamp = normalize(vec3(-0.58, 0.72, 0.65));
    float diffuse = 0.22 + 0.78 * max(dot(n, lamp), 0.0);
    float facing = max(n.z, 0.0);
    float rim = pow(1.0 - facing, 3.2);
    vec3 halfLight = normalize(lamp + vec3(0.0, 0.0, 1.0));
    float specular = pow(max(dot(n, halfLight), 0.0), 46.0);
    float reflection = pow(max(dot(n, halfLight), 0.0), 8.0);
    vec3 color = mix(uDeep, uCore, diffuse * 0.92);
    color += uLight * (0.12 * reflection + 0.21 * rim);
    color = mix(color, mix(uLight, vec3(1.0), 0.64), specular * 0.86);
    color += uCore * 0.15 * smoothstep(0.15, 0.86, -n.y) * facing;
    float shadowDist = length((p - vec2(0.045, -0.12)) * vec2(1.0, 1.04));
    float shadow = (1.0 - smoothstep(0.8, 1.1, shadowDist)) * 0.50;
    float alpha = surface + shadow * (1.0 - surface);
    gl_FragColor = vec4(color * (surface / max(alpha, 0.001)), alpha);
    #include <colorspace_fragment>
  }
`;

/** Draw each color once and share those shader sprites across all wallet cards. */
export function renderHoldingSprites(THREE) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 2;
  const geometry = new THREE.PlaneGeometry(2, 2);
  const uniforms = { uLight: { value: new THREE.Color() }, uCore: { value: new THREE.Color() }, uDeep: { value: new THREE.Color() } };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER });
  scene.add(new THREE.Mesh(geometry, material));
  renderer.setSize(192, 192, false);
  renderer.setClearColor(0x000000, 0);
  try {
    return HOLDING_PALETTE.map(([light, core, deep]) => {
      uniforms.uLight.value.set(light);
      uniforms.uCore.value.set(core);
      uniforms.uDeep.value.set(deep);
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    });
  } finally {
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
