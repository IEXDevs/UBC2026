'use client';

import { useEffect, useState } from 'react';

const THEMES = [
  {
    bg: ['#ff00cc', '#333399', '#00f2fe'],
    objects: ['#fa709a', '#fee140', '#ff0844', '#ffffff'],
  },
  {
    bg: ['#0ba360', '#3cba92', '#11998e'],
    objects: ['#43e97b', '#38f9d7', '#f4d03f', '#ffffff'],
  },
  {
    bg: ['#764ba2', '#667eea', '#6B8DD6'],
    objects: ['#8E37D7', '#00c6ff', '#89f7fe', '#ffffff'],
  },
  {
    bg: ['#f83600', '#f9d423', '#ff0844'],
    objects: ['#ffb199', '#fecfef', '#ff9a9e', '#ffffff'],
  },
  {
    bg: ['#0f2027', '#203a43', '#2c5364'],
    objects: ['#00f2fe', '#4facfe', '#f093fb', '#f5576c'],
  },
];

function generateWavePath(length, isVertical) {
  let path = isVertical ? 'M 20 0' : 'M 0 20';
  const segments = Math.ceil(length / 40);
  for (let i = 0; i < segments; i += 1) {
    if (isVertical) {
      path += ` Q ${i % 2 === 0 ? 40 : 0} ${i * 40 + 20}, 20 ${i * 40 + 40}`;
    } else {
      path += ` Q ${i * 40 + 20} ${i % 2 === 0 ? 40 : 0}, ${i * 40 + 40} 20`;
    }
  }
  return path;
}

/** Full-screen 404. Used for missing routes and for crashes that would otherwise blank the page. */
export default function NotFoundScreen() {
  const [shapes, setShapes] = useState([]);
  const [themeIndex, setThemeIndex] = useState(null);

  useEffect(() => {
    const tIndex = Math.floor(Math.random() * THEMES.length);
    setThemeIndex(tIndex);
    const theme = THEMES[tIndex];

    const generated = Array.from({ length: 100 }).map((_, i) => {
      const isVertical = Math.random() > 0.5;
      return {
        id: i,
        type: ['circle', 'square', 'triangle', 'pill'][Math.floor(Math.random() * 4)],
        color: theme.objects[Math.floor(Math.random() * theme.objects.length)],
        size: Math.random() * 150 + 40,
        left: Math.random() * 140 - 20,
        top: Math.random() * 140 - 20,
        duration: Math.random() * 10 + 5,
        delay: Math.random() * -40,
        rotation: 0,
        isVertical,
      };
    });
    setShapes(generated);
  }, []);

  return (
    <div suppressHydrationWarning className="fixed inset-0 z-[80] flex h-screen w-full items-center justify-center overflow-hidden bg-[#030303]">
      {themeIndex !== null && (
        <>
          <div
            className="absolute inset-0 z-0 animate-[gradientBg_15s_ease_infinite] opacity-100"
            style={{
              background: `linear-gradient(-45deg, ${THEMES[themeIndex].bg[0]}, ${THEMES[themeIndex].bg[1]}, ${THEMES[themeIndex].bg[2]})`,
              backgroundSize: '400% 400%',
            }}
          />

          <div className="absolute inset-0 z-0 overflow-hidden">
            {shapes.map((s) => {
              if (s.type === 'wave') {
                const w = s.isVertical ? 40 : s.size;
                const h = s.isVertical ? s.size : 40;
                return (
                  <div
                    key={s.id}
                    className="absolute opacity-60 mix-blend-overlay"
                    style={{
                      left: `${s.left}vw`,
                      top: `${s.top}vh`,
                      width: `${w}px`,
                      height: `${h}px`,
                      animation: `floatAndSpin ${s.duration}s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite alternate`,
                      animationDelay: `${s.delay}s`,
                      transform: `rotate(${s.rotation}deg)`,
                      transformOrigin: 'center center',
                    }}
                  >
                    <svg
                      width="100%"
                      height="100%"
                      viewBox={`0 0 ${w} ${h}`}
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d={generateWavePath(s.size, s.isVertical)}
                        stroke={s.color}
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                );
              }

              const isTriangle = s.type === 'triangle';
              return (
                <div
                  key={s.id}
                  className="absolute opacity-80 mix-blend-overlay"
                  style={{
                    left: `${s.left}vw`,
                    top: `${s.top}vh`,
                    width: isTriangle ? 0 : `${s.size}px`,
                    height: isTriangle ? 0 : `${s.size}px`,
                    backgroundColor: isTriangle ? 'transparent' : s.color,
                    borderRadius: s.type === 'circle' ? '50%' : s.type === 'pill' ? '9999px' : '0',
                    borderLeft: isTriangle ? `${s.size / 2}px solid transparent` : 'none',
                    borderRight: isTriangle ? `${s.size / 2}px solid transparent` : 'none',
                    borderBottom: isTriangle ? `${s.size}px solid ${s.color}` : 'none',
                    animation: `floatAndSpin ${s.duration}s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite alternate`,
                    animationDelay: `${s.delay}s`,
                    transformOrigin: 'center center',
                    boxShadow: !isTriangle ? `0 0 30px ${s.color}66` : 'none',
                  }}
                />
              );
            })}
          </div>
        </>
      )}

      <style dangerouslySetInnerHTML={{
        __html: `
        @keyframes gradientBg {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes floatAndSpin {
          0% {
            transform: translate(0, 0) rotate(0deg) scale(0.8);
          }
          50% {
            transform: translate(150px, -200px) rotate(180deg) scale(1.5);
          }
          100% {
            transform: translate(-150px, 200px) rotate(360deg) scale(0.8);
          }
        }
      `,
      }}
      />

      <div className="z-10 flex flex-col items-center justify-center gap-6">
        <h1 className="text-[14rem] font-black leading-none text-white drop-shadow-[0_0_50px_rgba(255,255,255,0.4)] mix-blend-overlay sm:text-[18rem]">
          404
        </h1>
        <a
          href="/"
          className="group inline-flex items-center rounded-full border border-white/30 bg-white/10 px-12 py-5 text-sm font-bold uppercase tracking-widest text-white backdrop-blur-md transition-all duration-300 hover:scale-110 hover:border-transparent hover:bg-white hover:text-black hover:shadow-[0_0_40px_rgba(255,255,255,0.6)]"
        >
          Return Home
        </a>
      </div>
    </div>
  );
}
