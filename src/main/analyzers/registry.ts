import { LogAnalyzer } from './types';

// Registry for available analyzers
class AnalyzerRegistry {
  private analyzers = new Map<string, LogAnalyzer>();

  register(analyzer: LogAnalyzer): void {
    this.analyzers.set(analyzer.name, analyzer);
  }

  unregister(name: string): void {
    this.analyzers.delete(name);
  }

  get(name: string): LogAnalyzer | undefined {
    return this.analyzers.get(name);
  }

  getDefault(): LogAnalyzer | undefined {
    // Return first registered analyzer as default
    return this.analyzers.values().next().value;
  }

  list(): LogAnalyzer[] {
    return [...this.analyzers.values()];
  }

  async getAvailable(): Promise<LogAnalyzer[]> {
    const available: LogAnalyzer[] = [];
    for (const analyzer of this.analyzers.values()) {
      if (!analyzer.isAvailable || await analyzer.isAvailable()) {
        available.push(analyzer);
      }
    }
    return available;
  }

  listInfo(): Array<{ name: string; description: string }> {
    return this.list().map(a => ({
      name: a.name,
      description: a.description
    }));
  }
}

// Global singleton registry
export const analyzerRegistry = new AnalyzerRegistry();
