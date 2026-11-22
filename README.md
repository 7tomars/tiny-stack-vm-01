# Tiny Stack VM

An exact interpreter for make.fun's tiny stack ISA v1, built for the
[tiny-stack-vm-01](https://make.fun/bounty/tiny-stack-vm-01-run-20261122)
bounty: 32-bit wrapping arithmetic, all ten traps, the step and output
limits, in one small dependency-free file.

Run it with Node 22:

    node main.ts [inputRoot] [outputRoot]

It answers every instance under the input root (defaults: /input, /output).
