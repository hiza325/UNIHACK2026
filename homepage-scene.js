// Presentation only: enhance the static hero on pointer interaction, when visible and idle.
const mounts = new WeakMap();
export function mountHomepageScene(host) {
  if (!host?.isConnected) return;
  mounts.get(host)?.();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let disposed = false, visible = false, engaged = false, loading = false, renderer, scene, camera, robot;
  let frame = 0, idle = 0, last = 0;
  const pointer = { x: 0, y: 0 };
  const stop = () => { cancelAnimationFrame(frame); frame = 0; };
  const resize = () => {
    if (!renderer) return;
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
    camera.updateProjectionMatrix();
  };
  const tick = time => {
    frame = 0;
    if (disposed || !visible || document.hidden || motion.matches || !renderer) return;
    if (time - last >= 33) {
      robot.rotation.y += (pointer.x * .45 - robot.rotation.y) * .08;
      robot.rotation.x += (pointer.y * .2 - robot.rotation.x) * .08;
      robot.position.y = Math.sin(time / 1800) * .06;
      renderer.render(scene, camera);
      last = time;
    }
    frame = requestAnimationFrame(tick);
  };
  const resume = () => {
    stop();
    host.classList.toggle('has-webgl', !!renderer && !motion.matches);
    if (!disposed && engaged && visible && !document.hidden && !motion.matches) {
      if (renderer) frame = requestAnimationFrame(tick);
      else schedule();
    }
  };
  async function load() {
    idle = 0;
    if (disposed || loading || renderer || !visible || document.hidden || motion.matches) return;
    loading = true;
    try {
      const T = await import('./vendor/three/three.module.min.js');
      if (disposed || !host.isConnected) return;
      renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      scene = new T.Scene();
      camera = new T.PerspectiveCamera(38, 1, .1, 30);
      camera.position.set(0, .1, 7.6);
      robot = new T.Group();
      scene.add(robot);
      scene.add(new T.AmbientLight(0xffffff, 1.6));
      [[-3, 4, 5, 3], [3, 1, 2, 2], [0, -3, -2, 2]].forEach(([x,y,z,intensity]) => {
        const light = new T.DirectionalLight(0xffffff, intensity);
        light.position.set(x,y,z); scene.add(light);
      });
      const silver = new T.MeshStandardMaterial({ color: 0xbfc1c8, metalness: .65, roughness: .27 });
      const black = new T.MeshStandardMaterial({ color: 0x080809, metalness: .2, roughness: .25 });
      const white = new T.MeshBasicMaterial({ color: 0xffffff });
      const ellipsoid = (material, scale, position) => {
        const mesh = new T.Mesh(new T.SphereGeometry(1, 32, 20), material);
        mesh.scale.set(...scale); mesh.position.set(...position); robot.add(mesh);
        return mesh;
      };
      ellipsoid(silver, [1.35, 1.02, .82], [0, 0, 0]);
      ellipsoid(black, [1.12, .68, .27], [0, -.08, .72]);
      for (const x of [-.43, .43]) ellipsoid(white, [.095, .19, .07], [x, .02, .98]);
      for (const x of [-1.34, 1.34]) ellipsoid(silver, [.22, .43, .36], [x, -.02, 0]);
      const antenna = new T.Mesh(new T.CylinderGeometry(.045, .07, .42, 12), silver);
      antenna.position.y = 1.15; robot.add(antenna);
      ellipsoid(white, [.13, .13, .13], [0, 1.43, 0]);
      const ring = new T.Mesh(new T.TorusGeometry(1.85, .012, 8, 80), silver);
      ring.rotation.set(1.15, .25, -.3); robot.add(ring);
      resize();
      renderer.render(scene, camera);
      renderer.domElement.setAttribute('aria-hidden', 'true');
      renderer.domElement.addEventListener('webglcontextlost', dispose, { once: true });
      host.append(renderer.domElement);
      resume();
    } catch { dispose(); }
  }
  function schedule() {
    if (idle || loading) return;
    idle = window.requestIdleCallback ? requestIdleCallback(load) : setTimeout(load, 0);
  }
  const move = event => {
    const bounds = host.getBoundingClientRect();
    pointer.x = (event.clientX - bounds.left) / bounds.width - .5;
    pointer.y = (event.clientY - bounds.top) / bounds.height - .5;
  };
  const reset = () => { pointer.x = pointer.y = 0; };
  const engage = () => { if (!engaged) { engaged = true; resume(); } };
  const intersection = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; resume(); }, { threshold: .05 });
  const sizing = new ResizeObserver(resize);
  const removal = new MutationObserver(() => { if (!host.isConnected) dispose(); });
  function dispose() {
    if (disposed) return;
    disposed = true; stop();
    if (window.cancelIdleCallback) cancelIdleCallback(idle); else clearTimeout(idle);
    intersection.disconnect(); sizing.disconnect(); removal.disconnect();
    host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', reset);
    host.removeEventListener('pointerenter', engage); host.removeEventListener('pointerdown', engage);
    document.removeEventListener('visibilitychange', resume); motion.removeEventListener('change', resume);
    const materials = new Set();
    scene?.traverse(object => { object.geometry?.dispose(); if (object.material) materials.add(object.material); });
    materials.forEach(material => material.dispose());
    renderer?.dispose(); renderer?.domElement.remove();
    host.classList.remove('has-webgl'); mounts.delete(host);
  }
  host.addEventListener('pointermove', move, { passive: true });
  host.addEventListener('pointerenter', engage, { passive: true });
  host.addEventListener('pointerdown', engage, { passive: true });
  host.addEventListener('pointerleave', reset);
  document.addEventListener('visibilitychange', resume); motion.addEventListener('change', resume);
  removal.observe(host.closest('edu-app'), { childList: true });
  sizing.observe(host); intersection.observe(host); mounts.set(host, dispose);
}
