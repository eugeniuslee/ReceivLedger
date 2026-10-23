import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
export function compileV2() {
  if (solc.version() !== '0.8.38+commit.1835d247.Emscripten.clang') throw new Error('Pinned solc 0.8.38 is required');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@openzeppelin/contracts/package.json'), 'utf8')).version !== '5.6.1') throw new Error('Pinned OpenZeppelin 5.6.1 is required');
  const input = { language: 'Solidity', sources: { 'contracts/ReceivLedgerV2.sol': { content: fs.readFileSync(new URL('../contracts/ReceivLedgerV2.sol', import.meta.url), 'utf8') } }, settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } };
  const resolvedSources = { ...input.sources };
  const result = JSON.parse(solc.compile(JSON.stringify(input), { import: name => {
    if (!name.startsWith('@openzeppelin/contracts/')) return { error: 'Unapproved import' };
    const contents = fs.readFileSync(path.resolve(root, 'node_modules', name), 'utf8');
    resolvedSources[name] = { content: contents };
    return { contents };
  } }));
  for (const error of result.errors ?? []) if (error.severity === 'error') throw new Error(error.formattedMessage);
  const contract = result.contracts['contracts/ReceivLedgerV2.sol'].ReceivLedgerV2;
  const size = contract.evm.deployedBytecode.object.length / 2;
  if (size > 24576) throw new Error('V2 exceeds the EIP-170 code size limit: ' + size);
  const initSize = contract.evm.bytecode.object.length / 2;
  if (initSize + 32 > 49152) throw new Error('V2 constructor exceeds EIP-3860 initcode limit');
  return { ...contract, size, initSize, compiler: solc.version(), standardInput: { ...input, sources: resolvedSources }, warnings: (result.errors ?? []).map(e => e.formattedMessage) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = compileV2();
  if (process.argv.includes('--write-abi')) fs.writeFileSync(new URL('../src/v2/abi.json', import.meta.url), JSON.stringify(result.abi, null, 2) + '\n');
  console.log(JSON.stringify({ compiler: result.compiler, runtimeBytes: result.size, warnings: result.warnings }));
}
