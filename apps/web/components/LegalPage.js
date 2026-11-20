import { PRIVACY, TERMS } from '../lib/legal-copy.mjs';

const PAGES = Object.freeze([PRIVACY, TERMS]);

export default function LegalPage({ doc }) {
  return (
    <main className="legal">
      <header className="legal-bar">
        <a className="legal-mark" href="/">Maelstrom</a>
        <nav className="legal-nav" aria-label="Legal">
          {PAGES.map(page => (
            <a
              key={page.kind}
              href={page.kind === 'privacy' ? '/privacy' : '/tos'}
              aria-current={page.kind === doc.kind ? 'page' : undefined}
            >
              {page.title}
            </a>
          ))}
        </nav>
      </header>
      <article className="legal-body">
        <h1>{doc.title}</h1>
        <p className="legal-updated">Effective {doc.updated}</p>
        <p className="legal-intro">{doc.intro}</p>
        {doc.sections.map(section => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
          </section>
        ))}
      </article>
    </main>
  );
}
