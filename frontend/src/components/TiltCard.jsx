import { useCallback, useRef } from 'react';

/**
 * Wraps children in a card that tilts in 3D toward the cursor and springs
 * back on mouse-leave. Pure CSS transform driven by mouse position — no
 * animation library. `glare` adds a soft light-follows-cursor highlight.
 */
export default function TiltCard({ children, className = '', maxTilt = 10, glare = true, ...rest }) {
  const ref = useRef(null);

  const handleMouseMove = useCallback(
    (e) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const rotateY = (x - 0.5) * maxTilt * 2;
      const rotateX = (0.5 - y) * maxTilt * 2;
      el.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.015, 1.015, 1.015)`;
      if (glare) {
        el.style.setProperty('--glare-x', `${x * 100}%`);
        el.style.setProperty('--glare-y', `${y * 100}%`);
        el.style.setProperty('--glare-o', '1');
      }
    },
    [maxTilt, glare]
  );

  const handleMouseLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
    el.style.setProperty('--glare-o', '0');
  }, []);

  return (
    <div ref={ref} className={`tilt-card ${className}`} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} {...rest}>
      {glare && <div className="tilt-glare" aria-hidden="true" />}
      {children}
    </div>
  );
}
