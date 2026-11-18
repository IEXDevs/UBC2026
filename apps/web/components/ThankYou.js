import { THANK_YOU } from '../lib/thank-you.mjs';
import './ThankYou.css';

export default function ThankYou() {
  return (
    <main className="thanks">
      <header className="thanks-bar">
        <a className="thanks-mark" href="/">Maelstrom</a>
      </header>
      <section className="thanks-body">
        <h1>Thank you</h1>
        <p>Built with these companies.</p>
        <ul className="thanks-logos">
          {THANK_YOU.map(company => (
            <li key={company.name}>
              <a href={company.href} target="_blank" rel="noreferrer">
                <img src={company.src} alt="" />
                <span>{company.name}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
