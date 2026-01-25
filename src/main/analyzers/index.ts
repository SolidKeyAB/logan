// Analyzer exports
export * from './types';
export { analyzerRegistry } from './registry';
export { RuleBasedAnalyzer } from './ruleBasedAnalyzer';
export { DrainAnalyzer } from './drainAnalyzer';
export { ColumnAwareAnalyzer } from './columnAwareAnalyzer';

// Register built-in analyzers
import { analyzerRegistry } from './registry';
import { DrainAnalyzer } from './drainAnalyzer';
import { RuleBasedAnalyzer } from './ruleBasedAnalyzer';
import { ColumnAwareAnalyzer } from './columnAwareAnalyzer';

// Column-aware is the default (registered first) - best for structured logs
analyzerRegistry.register(new ColumnAwareAnalyzer());
analyzerRegistry.register(new DrainAnalyzer());
analyzerRegistry.register(new RuleBasedAnalyzer());
