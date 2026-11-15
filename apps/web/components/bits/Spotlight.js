'use client';

export default function Spotlight({ className = '', children, ...rest }) {
  function move(event) {
    const node = event.currentTarget;
    const rect = node.getBoundingClientRect();
    node.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
    node.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
  }

  return (
    <div className={`spotlight ${className}`.trim()} onMouseMove={move} {...rest}>
      <span className="spotlight__glow" aria-hidden="true" />
      {children}
    </div>
  );
}
