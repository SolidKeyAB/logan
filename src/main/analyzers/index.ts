// Analyzer exports
export * from './types';
export { analyzerRegistry } from './registry';
export { RuleBasedAnalyzer } from './ruleBasedAnalyzer';
export { DrainAnalyzer } from './drainAnalyzer';

// Register built-in analyzers
import { analyzerRegistry } from './registry';
import { DrainAnalyzer } from './drainAnalyzer';
import { RuleBasedAnalyzer } from './ruleBasedAnalyzer';

// Drain is the default (registered first) - better pattern discovery
analyzerRegistry.register(new DrainAnalyzer());
analyzerRegistry.register(new RuleBasedAnalyzer());
