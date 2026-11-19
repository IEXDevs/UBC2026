/**
 * Skills the owner can call. Each file in ./available stays out of the
 * standing prompt and is added to a turn only when that command is used.
 */
import agentArchitectureAudit from './available/agent-architecture-audit.mjs';
import agentEval from './available/agent-eval.mjs';
import codeReview from './available/code-review.mjs';
import codebaseDesign from './available/codebase-design.mjs';
import cryptoData from './available/crypto-data.mjs';
import cryptoMarketRank from './available/crypto-market-rank.mjs';
import cryptoReport from './available/crypto-report.mjs';
import cryptoResearch from './available/crypto-research.mjs';
import dataScraperAgent from './available/data-scraper-agent.mjs';
import deepResearch from './available/deep-research.mjs';
import diagnosingBugs from './available/diagnosing-bugs.mjs';
import domainModeling from './available/domain-modeling.mjs';
import implement from './available/implement.mjs';
import iterativeRetrieval from './available/iterative-retrieval.mjs';
import llmTradingAgentSecurity from './available/llm-trading-agent-security.mjs';
import marketResearch from './available/market-research.mjs';
import marketSentiment from './available/market-sentiment.mjs';
import postgresPatterns from './available/postgres-patterns.mjs';
import pythonPatterns from './available/python-patterns.mjs';
import pythonTesting from './available/python-testing.mjs';
import redisPatterns from './available/redis-patterns.mjs';
import researchOps from './available/research-ops.mjs';
import review from './available/review.mjs';
import tdd from './available/tdd.mjs';
import tradingStrategist from './available/trading-strategist.mjs';

const skills = [
  agentArchitectureAudit,
  agentEval,
  codeReview,
  codebaseDesign,
  cryptoData,
  cryptoMarketRank,
  cryptoReport,
  cryptoResearch,
  dataScraperAgent,
  deepResearch,
  diagnosingBugs,
  domainModeling,
  implement,
  iterativeRetrieval,
  llmTradingAgentSecurity,
  marketResearch,
  marketSentiment,
  postgresPatterns,
  pythonPatterns,
  pythonTesting,
  redisPatterns,
  researchOps,
  review,
  tdd,
  tradingStrategist,
];
skills.sort((a, b) => a.order - b.order);
export const AVAILABLE_SKILLS = Object.freeze(skills);
