import process from 'node:process'

console.error(process.platform === 'win32'
  ? 'NOT RUN: real Node/Rust named-pipe integration coverage is required before this command can pass.'
  : 'NOT RUN: test:bridge:integration requires Windows named pipes.')
process.exitCode = 2
