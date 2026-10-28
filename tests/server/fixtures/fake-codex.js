// A stand-in for Codex's npm package script: prints Codex's JSON lines. FAKE_CODEX_MODE=fail: says
// something, then the turn fails. Otherwise it answers with whether its quoted settings arrived whole.
const say = (ev) => process.stdout.write(JSON.stringify(ev) + '\n');
process.stdin.resume();
process.stdin.on('data', () => {});
process.stdin.on('end', () => {
  say({ type: 'thread.started', thread_id: 'th-1' });
  if (process.env.FAKE_CODEX_MODE === 'fail') {
    say({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: "I'll inspect the files." } });
    say({ type: 'turn.failed', error: { message: 'stream disconnected' } });
    process.exit(1);
  }
  const quoted = process.argv.some((a) => /^mcp_servers\.dashboard\.command=".+"$/.test(a));
  say({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: `quoted:${quoted}` } });
  say({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
});
