// PARADOX DIMENSION: nested architectural apertures, not an orbital sphere.
const mounts = new WeakMap();
export function mountNeuralCore(host) {
  if (!host) return;
  mounts.get(host)?.();
  const layer = document.createElement('div');
  layer.className = 'neural-core paradox-dimension';
  layer.setAttribute('aria-hidden', 'true');
  host.prepend(layer);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  if (motion.matches) return;
  let disposed = false, visible = false, frame = 0, renderer, scene, camera, group;
  let loading = false, last = 0, elapsed = 0, scroll = 0;
  const apertures = [], fragments = [];
  const onScroll = () => { scroll = Math.max(-1, Math.min(1, -host.getBoundingClientRect().top / innerHeight)); };
  const pointer = { x: 0, y: 0 };
  const move = event => {
    const box = host.getBoundingClientRect();
    pointer.x = (event.clientX - box.left) / box.width - .5;
    pointer.y = (event.clientY - box.top) / box.height - .5;
  };
  const stop = () => { cancelAnimationFrame(frame); frame = 0; };
  const tick = time => {
    frame = 0;
    if (disposed || !visible || document.hidden || motion.matches || !renderer) return;
    if (time - last > 32) {
      elapsed += Math.min((time - last) / 1000, .05);
      group.rotation.y += (-.32 + pointer.x * .24 - group.rotation.y) * .04;
      group.rotation.x += (.14 + pointer.y * .16 + scroll * .12 - group.rotation.x) * .04;
      group.position.x += (pointer.x * .3 - group.position.x) * .04;
      group.position.y = Math.sin(elapsed * .5) * .06;
      const entrance = Math.min(1, elapsed / 1.5);
      group.scale.setScalar(.85 + .15 * (1 - Math.pow(1 - entrance, 3)));
      apertures.forEach((mesh, i) => { mesh.rotation.z = Math.PI / 4 + Math.sin(elapsed * .2 + i * .5) * .08; });
      fragments.forEach((mesh, i) => { mesh.rotation.y = elapsed * .16 + i; mesh.rotation.z = elapsed * .08 + i; });
      renderer.render(scene, camera);
      last = time;
    }
    frame = requestAnimationFrame(tick);
  };
  const resume = () => { stop(); if (visible && !document.hidden && !motion.matches) frame = requestAnimationFrame(tick); };
  const resize = new ResizeObserver(() => {
    if (!renderer) return;
    const { width, height } = host.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  });
  const observer = new IntersectionObserver(async entries => {
    visible = entries[0].isIntersecting;
    if (!visible) { stop(); return; }
    if (!renderer && !loading) {
      loading = true;
      try {
        const T = await import('./vendor/three/three.module.min.js');
        if (disposed) return;
        renderer = new T.WebGLRenderer({ alpha:true, antialias:false, powerPreference:'low-power' });
        renderer.setPixelRatio(1);
        renderer.setClearColor(0x080b14, 0);
        scene = new T.Scene();
        camera = new T.PerspectiveCamera(42, 1, .1, 50);
        camera.position.z = 7.4;
        group = new T.Group(); scene.add(group);
        scene.add(new T.AmbientLight(0xadbaff, 1.8));
        [[0x8b5cf6, -3, 2, 4], [0x38e8ff, 3, -1, 3], [0xffffff, 0, 4, 2]].forEach(([color,x,y,z]) => {
          const light = new T.DirectionalLight(color, 3); light.position.set(x,y,z); scene.add(light);
        });
        // Four beveled square gates form a luminous corridor with a dark negative-space center.
        for (let i=0; i<4; i++) {
          const size = 1.45 - i * .24, width = .075;
          const shape = new T.Shape();
          shape.moveTo(-size,-size); shape.lineTo(size,-size); shape.lineTo(size,size); shape.lineTo(-size,size); shape.closePath();
          const hole = new T.Path();
          hole.moveTo(-size+width,-size+width); hole.lineTo(-size+width,size-width); hole.lineTo(size-width,size-width); hole.lineTo(size-width,-size+width); hole.closePath();
          shape.holes.push(hole);
          const gate = new T.Mesh(new T.ExtrudeGeometry(shape, { depth:.13, bevelEnabled:true, bevelSegments:2, steps:1, bevelSize:.035, bevelThickness:.035 }), new T.MeshPhongMaterial({ color:i%2 ? 0x91e8ff : 0x9d7dff, shininess:85, specular:0xbbeeff, emissive:i%2 ? 0x09647f : 0x3e167d, emissiveIntensity:.65 }));
          gate.position.z = .6 - i * .48; group.add(gate); apertures.push(gate);
        }
        // Broken elliptical trajectories sweep around the architectural sculpture.
        for (let i=0;i<2;i++) {
          const points=[];
          for(let j=0;j<=64;j++) { const a=j/64*Math.PI*1.45+i*2; points.push(new T.Vector3(Math.cos(a)*2.15,Math.sin(a)*.64,(Math.sin(a)*.5)+(i-.5)*.8)); }
          const arc=new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:i ? 0x9b87ff:0x38bdf8,transparent:true,opacity:.45}));
          arc.rotation.z=i ? -.35:.3; group.add(arc);
        }
        for(let i=0;i<5;i++) {
          const shard=new T.Mesh(new T.BoxGeometry(.12,.32,.12),new T.MeshPhongMaterial({color:i%2?0xd8f6ff:0xa78bfa,shininess:85}));
          const a=i*2.4; shard.position.set(Math.cos(a)*1.95,Math.sin(a)*1.65,.2+Math.sin(i)); group.add(shard); fragments.push(shard);
        }
        const positions = new Float32Array((innerWidth < 700 ? 28 : 56) * 3);
        for (let i=0;i<positions.length;i+=3) {
          const a=i*2.399, radius=1.9+(i%7)*.09;
          positions[i]=Math.cos(a)*radius; positions[i+1]=Math.sin(a)*radius*.8; positions[i+2]=-1+(i%11)*.17;
        }
        const geometry = new T.BufferGeometry();
        geometry.setAttribute('position', new T.BufferAttribute(positions,3));
        group.add(new T.Points(geometry,new T.PointsMaterial({ color:0x38bdf8,size:.025 })));
        layer.append(renderer.domElement); layer.classList.add('is-ready');
        renderer.domElement.addEventListener('webglcontextlost', dispose, { once:true });
        resize.observe(host);
      } catch { dispose(); }
    }
    resume();
  }, { threshold:.05 });
  function dispose() {
    if (disposed) return;
    disposed=true; stop(); observer.disconnect(); resize.disconnect(); removal.disconnect();
    host.removeEventListener('pointermove', move);
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('visibilitychange', resume);
    motion.removeEventListener('change', resume);
    scene?.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
    renderer?.dispose(); renderer?.domElement.remove(); layer.classList.remove('is-ready');
    mounts.delete(host);
  }
  const removal = new MutationObserver(() => { if (!host.isConnected) dispose(); });
  removal.observe(host.closest('edu-app'), { childList:true });
  host.addEventListener('pointermove', move, { passive:true });
  window.addEventListener('scroll', onScroll, { passive:true });
  document.addEventListener('visibilitychange', resume);
  motion.addEventListener('change', resume);
  observer.observe(host);
  mounts.set(host, () => { dispose(); layer.remove(); });
}
