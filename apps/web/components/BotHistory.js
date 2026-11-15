'use client';

import { useMemo } from 'react';
import { botHistoryRows, filterBotHistory } from '../lib/bot-history.mjs';
import TxnLog from './TxnLog';

export default function BotHistory({ bot, bots = [], payments = [], transfers = [], onParty }) {
  const rows = useMemo(
    () => filterBotHistory(botHistoryRows({ payments, transfers, bots }), { botId: bot.id }),
    [payments, transfers, bots, bot.id],
  );

  return (
    <div className="bot-history">
      <TxnLog rows={rows} onParty={onParty} empty="No history for this bot." />
    </div>
  );
}
