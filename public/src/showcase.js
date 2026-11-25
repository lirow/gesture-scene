import * as THREE from 'three';
import { PRESETS } from './presets/index.js';
import { sampleShape } from './engine/showcase-shapes.js';
import { mulberry32 } from './engine/util.js';

const canvas = document.getElementById('stage');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const rotate = document.getElementById('rotate');
const built = typeof __SHOWCASE_BUILD__ !== 'undefined' && __SHOWCASE_BUILD__;
let active = new URLSearchParams(location.search).get('preset') === 'xmas2026' ? 'xmas2026' : 'heart';
let target = active === 'heart' ? 0 : 1;
const state = { ready: false, preset: active, frames: 0, morph: target };
window.__showcase = state;
let wake = () => {};

function syncControls() {
  state.preset = active;
  const heart = active === 'heart';
  document.querySelectorAll('[data-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.theme === active)));
  document.getElementById('scene-name').textContent = heart ? '粉色爱心' : '粒子圣诞树';
  const enter = document.getElementById('enter');
  enter.textContent = heart ? '进入爱心场景' : '进入圣诞场景';
  enter.href = built ? (heart ? './heart.html' : './xmas.html') : `./scene.html?preset=${active}`;
  document.documentElement.style.setProperty('--accent', heart ? '#ff8dab' : '#b8dfaa');
}
syncControls();
document.querySelectorAll('[data-theme]').forEach(button => button.addEventListener('click', () => {
  active = button.dataset.theme; target = active === 'heart' ? 0 : 1;
  syncControls(); wake();
}));

try {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearColor('#08090e', 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 50);
  const count = window.innerWidth < 600 ? 4600 : 9000;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(sampleShape(PRESETS.heart, count), 3));
  geometry.setAttribute('aTree', new THREE.BufferAttribute(sampleShape(PRESETS.xmas2026, count), 3));
  const random = mulberry32(90210);
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(Float32Array.from({ length: count }, random), 1));
  const uniforms = {
    uMorph: { value: target }, uTime: { value: 0 }, uPixelScale: { value: 1 },
    uPointer: { value: new THREE.Vector3(100, 100, 0) },
  };
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms,
    vertexShader: `
      attribute vec3 aTree; attribute float aSeed;
      uniform float uMorph; uniform float uTime; uniform float uPixelScale;
      uniform vec3 uPointer;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vec3 p = mix(position, aTree, uMorph);
        float phase = fract(uTime / 1.05);
        float beat = exp(-pow((phase - .10) / .07, 2.)) + .55 * exp(-pow((phase - .30) / .085, 2.));
        p *= 1. + beat * .025 * (1. - uMorph);
        p += .012 * sin(vec3(aSeed * 28., aSeed * 19., aSeed * 37.) + uTime * .65);
        vec3 delta = p - uPointer;
        float distanceToPointer = length(delta.xy);
        p.xy += normalize(delta.xy + .0001) * exp(-distanceToPointer * distanceToPointer * 4.) * .14;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp((.033 + aSeed * .025) * uPixelScale / -mv.z, 2., 14.);
        vec3 pink = mix(vec3(.85,.055,.28), vec3(1.,.50,.68), aSeed);
        vec3 festive = mix(vec3(.12,.70,.43), vec3(1.,.77,.29), step(.26,aSeed));
        if (aSeed > .94) festive = vec3(1.,.18,.20);
        vColor = mix(pink, festive, uMorph);
        vAlpha = .62 + .25 * sin(aSeed * 30. + uTime);
      }`,
    fragmentShader: `
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vec2 p = gl_PointCoord - .5;
        float r = length(p);
        if (r > .5) discard;
        float light = exp(-r*r*20.) * .35 + exp(-r*r*95.) * 1.2;
        gl_FragColor = vec4(vColor, light * vAlpha);
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geometry, material);
  scene.add(points);
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  let animation = 0, previous = performance.now(), time = 0, angle = 0;
  if (reduced.matches) { rotate.checked = false; rotate.disabled = true; }

  function draw(now) {
    animation = 0;
    const dt = Math.min((now - previous) / 1000, .05);
    previous = now;
    const running = rotate.checked && !reduced.matches;
    if (running) { time += dt; angle += dt * .18; }
    uniforms.uTime.value = time;
    const difference = target - uniforms.uMorph.value;
    uniforms.uMorph.value = reduced.matches || Math.abs(difference) < .001 ? target : uniforms.uMorph.value + difference * Math.min(1, dt * 6);
    points.rotation.y = Math.sin(angle) * .28;
    points.rotation.x = Math.sin(angle * .6) * .05;
    renderer.render(scene, camera);
    state.frames++; state.morph = uniforms.uMorph.value; state.ready = true;
    document.getElementById('status').textContent = running ? '实时' : '静止';
    if (!document.hidden && (running || Math.abs(target - uniforms.uMorph.value) > .001)) animation = requestAnimationFrame(draw);
  }
  function requestDraw() {
    if (!animation && !document.hidden) { previous = performance.now(); animation = requestAnimationFrame(draw); }
  }
  function resize() {
    const width = innerWidth, height = innerHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    const tangent = Math.tan(THREE.MathUtils.degToRad(43 / 2));
    const top = document.querySelector('header').getBoundingClientRect().bottom + 28;
    const bottom = document.querySelector('.controls').getBoundingClientRect().top - 28;
    const available = Math.max(120, bottom - top);
    camera.position.z = Math.max(5.7, 1.65 / (tangent * camera.aspect), 1.65 * height / (tangent * available));
    camera.position.y = ((top + bottom) / 2 - height / 2) * 2 / height * tangent * camera.position.z;
    camera.updateProjectionMatrix();
    uniforms.uPixelScale.value = height * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(43 / 2)));
    requestDraw();
  }
  wake = requestDraw;
  canvas.addEventListener('pointermove', event => {
    if (reduced.matches) return;
    pointer.set(event.clientX / innerWidth * 2 - 1, 1 - event.clientY / innerHeight * 2);
    ray.setFromCamera(pointer, camera);
    ray.ray.intersectPlane(plane, uniforms.uPointer.value);
    requestDraw();
  });
  canvas.addEventListener('pointerleave', () => { uniforms.uPointer.value.set(100, 100, 0); requestDraw(); });
  canvas.addEventListener('pointerup', () => { uniforms.uPointer.value.set(100, 100, 0); requestDraw(); });
  canvas.addEventListener('pointercancel', () => { uniforms.uPointer.value.set(100, 100, 0); requestDraw(); });
  rotate.addEventListener('change', requestDraw);
  reduced.addEventListener('change', () => {
    rotate.disabled = reduced.matches;
    if (reduced.matches) rotate.checked = false;
    requestDraw();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(animation); animation = 0; }
    else requestDraw();
  });
  addEventListener('resize', resize);
  state.render = () => { cancelAnimationFrame(animation); draw(performance.now()); };
  resize();
} catch (error) {
  document.body.classList.add('unavailable');
  rotate.disabled = true;
  document.getElementById('status').textContent = '预览不可用';
  console.warn('Particle preview unavailable:', error.message);
}
