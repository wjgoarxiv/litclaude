# Conference: Code Performance Optimization

> **Template: Code Performance** — Optimize code execution speed using parallel researchers with assigned optimization strategies.

## Goal
Minimize execution time of the target code. Each researcher explores a different optimization layer — algorithmic, data structures, and low-level — to find complementary speedups.

## Mode
metric

## Success Metric
- **Metric:** execution_time_seconds
- **Target:** {e.g., "< 0.5", "< 50"}
- **Direction:** minimize

## Researchers
- **Count:** 3
- **Iterations per round:** 5
- **Max rounds:** 4

## Search Space
- **Allowed changes:** implementation code, algorithm choice, data structures, caching strategies, memory layout, vectorization
- **Forbidden changes:** test harness, input data, public API contracts, correctness constraints (all tests must still pass)

## Search Space Partitioning
- **Strategy:** assigned

### Researcher A Focus
Algorithmic changes: complexity reduction (O(n²) → O(n log n)), better algorithms for the problem class, avoiding redundant computation, memoization of expensive calls.

### Researcher B Focus
Data structure optimization: choosing the right container types (list vs. dict vs. set), index structures, object layout, avoiding repeated lookups, batching operations.

### Researcher C Focus
Low-level optimization: caching hot paths, memory layout for cache locality, vectorization opportunities, reducing Python overhead (list comprehensions over loops, numpy where applicable), profiling-guided micro-optimizations.

## Constraints
- **Max total iterations:** 45
- **Time budget:** 2h
- **Researcher timeout:** 40m

## Current Approach
{Describe the current implementation. What does it do? What is the baseline execution time? Reference the code file(s) here.}

## Shared Knowledge
<!-- Auto-populated after each round with validated findings -->

## Context & References
- Target code: {path to file(s)}
- Benchmark script: {path to benchmark}
- Baseline execution time: {value} seconds
- Hardware: {CPU, RAM — for reproducibility}

---

## Conference Log
<!-- Auto-maintained by Conference Chair. Do not edit manually. -->
| Round | Researcher | Best Metric | Key Finding | Status |
|-------|-----------|-------------|-------------|--------|
