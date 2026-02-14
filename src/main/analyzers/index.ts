// Analyzer exports
export * from './types';
export { analyzerRegistry } from './registry';
export { ColumnAwareAnalyzer } from './columnAwareAnalyzer';

// Register built-in analyzers
import { analyzerRegistry } from './registry';
import { ColumnAwareAnalyzer } from './columnAwareAnalyzer';

analyzerRegistry.register(new ColumnAwareAnalyzer());
