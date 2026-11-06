// Liquid Chrome AI Core — monochrome glass + metallic material.
// Landing-only, lazy-loaded, performance-conscious.
export function mountLiquidChrome(host) {
  if (!host) return;
  const layer = document.createElement('div');
  layer.className = 'liquid-chrome';
  layer.setAttribute('aria-hidden', 'true');
  host.prepend(layer);

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  if (motion.matches) return;

  let disposed = false, visible = false, frame = 0, renderer, scene, camera, core;
  let loading = false, last = 0, elapsed = 0;
  const pointer = { x: 0, y: 0 };

  const move = (e) => {
    const box = host.getBoundingClientRect();
    pointer.x = (e.clientX - box.left) / box.width - 0.5;
    pointer.y = (e.clientY - box.top) / box.height - 0.5;
  };
  const stop = () => { cancelAnimationFrame(frame); frame = 0; };
  const tick = (time) => {
    frame = 0;
    if (disposed || !visible || document.hidden || motion.matches || !renderer) return;
    if (time - last > 32) {
      elapsed += (time - last) / 1000;
      core.rotation.y += (pointer.x * 0.4 - core.rotation.y) * 0.05;
      core.rotation.x += (pointer.y * 0.25 - core.rotation.x) * 0.05;
      core.position.y = Math.sin(elapsed * 0.6) * 0.08;
      renderer.render(scene, camera);
      last = time;
    }
    frame = requestAnimationFrame(tick);
  };
  const resume = () => { stop(); if (visible && !document.hidden && !motion.matches) frame = requestAnimationFrame(tick); };

  const observer = new IntersectionObserver(async (entries) => {
    visible = entries[0].isIntersecting;
    if (!visible) { stop(); return; }
    if (!renderer && !loading) {
      loading = true;
      try {
        const T = await import('./vendor/three/three.module.min.js');
        if (disposed) return;
        renderer = new T.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
        renderer.setClearColor(0x050505, 0);
        scene = new T.Scene();
        camera = new T.PerspectiveCamera(40, 1, 0.1, 50);
        camera.position.z = 5.5;

        // Liquid chrome core: icosahedron with high subdivision + metallic material
        core = new T.Group();
        scene.add(core);

        const geo = new T.IcosahedronGeometry(1.4, 2);
        const mat = new T.MeshStandardMaterial({
          color: 0xd4d4d4,
          metalness: 1.0,
          roughness: 0.08,
          envMapIntensity: 1.2,
        });
        const mesh = new T.Mesh(geo, mat);
        core.add(mesh);

        // Inner dark core for depth
        const innerGeo = new T.IcosahedronGeometry(0.9, 1);
        const innerMat = new T.MeshStandardMaterial({
          color: 0x1a1a1a,
          metalness: 0.6,
          roughness: 0.4,
        });
        const inner = new T.Mesh(innerGeo, innerMat);
        core.add(inner);

        // Subtle rim light
        const rim = new T.Mesh(
          new T.TorusGeometry(1.6, 0.02, 8, 64),
          new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 })
        );
        rim.rotation.x = Math.PI / 2;
        core.add(rim);

        // Minimal particles
        const particleCount = innerWidth < 700 ? 20 : 40;
        const positions = new Float32Array(particleCount * 3);
        for (let i = 0; i < particleCount * 3; i++) {
          positions[i] = (Math.random() - 0.5) * 4;
        }
        const particleGeo = new T.BufferGeometry();
        particleGeo.setAttribute('position', new T.BufferAttribute(positions, 3));
        const particles = new T.Points(
          particleGeo,
          new T.PointsMaterial({ color: 0xffffff, size: 0.015, transparent: true, opacity: 0.4 })
        );
        scene.add(particles);

        // Lights
        const ambient = new T.AmbientLight(0xffffff, 0.3);
        scene.add(ambient);
        const key = new T.DirectionalLight(0xffffff, 1.5);
        key.position.set(3, 2, 4);
        scene.add(key);
        const fill = new T.DirectionalLight(0x888888, 0.5);
        fill.position.set(-2, -1, 2);
        scene.add(fill);

        layer.append(renderer.domElement);
        layer.classList.add('is-ready');
        renderer.domElement.addEventListener('webglcontextlost', dispose, { once: true });

        const resize = () => {
          if (!renderer) return;
          const { width, height } = host.getBoundingClientRect();
          renderer.setSize(width, height, false);
          camera.aspect = width / Math.max(height, 1);
          camera.updateProjectionMatrix();
        };
        resize();
        window.addEventListener('resize', resize);

        // Store resize for cleanup
        host._liquidResize = resize;
      } catch (e) {
        console.warn('Liquid Chrome load failed:', e);
        dispose();
      }
    }
    resume();
  }, { threshold: 0.05 });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stop();
    observer.disconnect();
    if (host._liquidResize) window.removeEventListener('resize', host._liquidResize);
    host.removeEventListener('pointermove', move);
    document.removeEventListener('visibilitychange', resume);
    motion.removeEventListener('change', resume);
    scene?.traverse((obj) => {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material?.dispose();
    });
    renderer?.dispose();
    renderer?.domElement?.remove();
    layer.classList.remove('is-ready');
  };

  const removal = new MutationObserver(() => { if (!host.isConnected) dispose(); });
  removal.observe(host.closest('edu-app') || document.body, { childList: true, subtree: true });

  host.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('visibilitychange', resume);
  motion.addEventListener('change', resume);
  observer.observe(host);
}
