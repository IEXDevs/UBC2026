/**
 * Privacy and terms shown at /privacy and /tos.
 * Amounts and product rules match the desk. The store vendor is unnamed.
 */

export const LEGAL_UPDATED = 'November 17, 2026';

export const PRIVACY = Object.freeze({
  kind: 'privacy',
  title: 'Privacy',
  updated: LEGAL_UPDATED,
  intro: 'This page describes what Maelstrom handles about you when you use the desk, an agent, voice, or file storage.',
  sections: Object.freeze([
    Object.freeze({
      heading: 'The account',
      paragraphs: Object.freeze([
        'Sign-in creates a session for you. Maelstrom keeps the handle you choose, a .sol name when you claim one, and the wallet address tied to that account. The address is shown as the first 5 and last 5 characters in the desk and copies when you click it.',
        'Spend settings stay with the account: Ask every time, Review by AI, or Full permissions, and the Review by AI maximum in USDC when you set one.',
      ]),
    }),
    Object.freeze({
      heading: 'Seeds and keys',
      paragraphs: Object.freeze([
        'Maelstrom does not store seed phrases or private keys. A new wallet asks you to download a recovery file and enter it again. That file is the copy you keep. A lost phrase cannot be recovered from Maelstrom.',
        'Logs may include other activity. They do not include private keys or seed phrases. Rows for your account stay limited to that owner.',
      ]),
    }),
    Object.freeze({
      heading: 'Agents, messages, and spends',
      paragraphs: Object.freeze([
        'Agent names, goals, and the messages you send are used to run that agent. The model receives file names when a file is attached. It does not receive file bytes or the private address used to open a stored file.',
        'Approvals, ledger totals, decisions, and events are stored for the account. Ledger totals come from that record. A model reply is not a balance.',
        'Execution that broadcasts is Solana devnet. Prices taken from mainnet are labeled devnet execution, mainnet pricing. A mainnet quote does not authorize a transaction.',
      ]),
    }),
    Object.freeze({
      heading: 'Files',
      paragraphs: Object.freeze([
        'File names, types, sizes, and a short preview of a recent image stay in this browser. The bytes of a saved file go to storage operated for Maelstrom.',
        'Each owner can hold 5 GB. An upload can continue after that, and older files for that owner are removed. A file larger than 512 MB is refused. The shared pool stops at 1 TB. Another owner’s files are left in place when the pool is full.',
        'The long address that opens a stored file stays in this browser. The store keeps a hash of that address.',
      ]),
    }),
    Object.freeze({
      heading: 'Voice, pages, and cards',
      paragraphs: Object.freeze([
        'When you use voice, the audio of that session is processed so the agent can answer. Voice uses the same spend permissions as the desk.',
        'When an agent opens a page, the session record belongs to that agent and its owner. A live view is returned on the owner route.',
        'A reloadable card belongs to you. You complete signup, identity checks, the issuer code, and the issuer terms. An agent may hand you the claim link and check status. It does not open that link or submit identity for you.',
      ]),
    }),
    Object.freeze({
      heading: 'Who else processes it',
      paragraphs: Object.freeze([
        'Sign-in, wallet signing, the account database, model replies, voice, and Solana devnet execution are handled by the services that run those parts of Maelstrom. They receive what that step needs. Maelstrom does not sell your personal information.',
      ]),
    }),
    Object.freeze({
      heading: 'How long it stays',
      paragraphs: Object.freeze([
        'Account, ledger, approval, and event records stay while the account is in use and as needed to operate the desk. Files follow the caps above. Copies in this browser stay until you clear them or the cap removes a preview.',
      ]),
    }),
    Object.freeze({
      heading: 'Changes',
      paragraphs: Object.freeze([
        'When this handling changes, the date at the top of this page changes with it. The terms at /tos cover use of the product, including liability.',
      ]),
    }),
  ]),
});

export const TERMS = Object.freeze({
  kind: 'terms',
  title: 'Terms',
  updated: LEGAL_UPDATED,
  intro: 'Maelstrom is a desk for agents that can research, check a spend, and pay on Solana devnet when you allow it. Using it means you agree to these terms and the privacy page.',
  sections: Object.freeze([
    Object.freeze({
      heading: 'What you are using',
      paragraphs: Object.freeze([
        'Agents can be wrong. Research, prices, trust scores, and suggested spends are information for you to judge. Execution that broadcasts is Solana devnet. Mainnet figures are prices, labeled devnet execution, mainnet pricing. A mainnet quote never authorizes a transaction.',
        'You choose Ask every time, Review by AI, or Full permissions. Ask and Full still use the confirm slide. Review by AI stores a USDC maximum you set. At or under that cap a spend can continue after the server check. Above that cap, you confirm.',
      ]),
    }),
    Object.freeze({
      heading: 'Accuracy',
      paragraphs: Object.freeze([
        'AI is not proven to be accurate all the time. Any information, financial or otherwise, can be wrong, incomplete, or out of date. Do not treat it as guaranteed. Do not treat it as financial advice from the creators. You decide whether to act on it.',
      ]),
    }),
    Object.freeze({
      heading: 'Provided as-is',
      paragraphs: Object.freeze([
        'Maelstrom is provided as-is. We make a best effort to reduce risk through caps, trust checks, a second look at a spend, approval modes, and wallet freezes. That risk can never be truly mitigated. A check can fail, lag, or miss. A transfer you confirm can still lose funds.',
      ]),
    }),
    Object.freeze({
      heading: 'No liability',
      paragraphs: Object.freeze([
        'We take no liability for any losses, or for any other result, that occurs because an agent, a quote, a price, or any other information was wrong.',
        'We take no liability for losses, harm, injury, or other forms of damage arising from use of Maelstrom. This includes lost funds, a transfer to the wrong place, a failed or unexpected transaction, a bad price, a missing file, downtime, and a decision you or an agent make.',
      ]),
    }),
    Object.freeze({
      heading: 'Your wallet',
      paragraphs: Object.freeze([
        'You keep the seed phrase and any private key. Maelstrom does not store them. A lost phrase cannot be recovered. You are responsible for the amount, the asset, and the destination you confirm, and for the permission mode you leave on.',
      ]),
    }),
    Object.freeze({
      heading: 'Files',
      paragraphs: Object.freeze([
        'Each owner can hold 5 GB. Reaching that cap can remove older files of yours so a new upload can continue. A file larger than 512 MB is refused. The shared pool is 1 TB. When it is full, the upload stops and other people’s files stay. Keep your own copy of anything you still need.',
      ]),
    }),
    Object.freeze({
      heading: 'Use of the desk',
      paragraphs: Object.freeze([
        'Use Maelstrom for your own account and your own funds. Do not use it to take funds, credentials, or data that are not yours, or to interfere with the service. You need to be at least 18.',
        'A reloadable card is yours. You complete the issuer’s signup, identity checks, code, and terms. Maelstrom can pass you the claim link and read status. It does not submit identity for you.',
      ]),
    }),
    Object.freeze({
      heading: 'Changes',
      paragraphs: Object.freeze([
        'A new version of these terms replaces the old one when it is posted on this page. The date at the top is the version in effect. If one sentence cannot be enforced, the rest still applies. Privacy is at /privacy. These terms are offered from Austin, Texas.',
      ]),
    }),
  ]),
});
