const item = (id, title, status, observed, expected, remediation = '', evidence = {}) => ({ id, title, status, observed, expected, remediation, evidence: { source: 'synthetic-local-fixture', ...evidence } });
export function rehearse(project, scenario = 'wrong-network') {
  if (!['wrong-network', 'ready', 'missing-code'].includes(scenario)) throw new Error('Unknown rehearsal scenario.');
  const observedChainId = scenario === 'wrong-network' ? 1 : 420420777;
  const expectedChainId = Number(project.expectedChainId ?? 420420777);
  const wrong = observedChainId !== expectedChainId || expectedChainId !== 420420777, missing = scenario === 'missing-code';
  return {
    network: { name: 'Local rehearsal fixtures', chainId: observedChainId, source: 'synthetic-local-fixture' },
    checks: [
      item('network.chain-id', 'Target network', wrong ? 'failed' : 'passed', `Fixture chain ${observedChainId}; saved project expects ${expectedChainId}.`, 'Both observed and expected chain ID must be 420420777', wrong ? 'Set the expected chain ID to 420420777 and choose Corrected configuration, then rerun.' : ''),
      item('network.finalized', 'Finalized observation', wrong ? 'blocked' : 'passed', wrong ? 'No target-chain anchor collected.' : 'Fixture observation anchor recorded.', 'Anchor the report to finalized state', wrong ? 'Resolve the target network first.' : ''),
      item('account.mapping', 'Account mapping', wrong ? 'blocked' : 'passed', wrong ? 'Target network mismatch prevents mapping checks.' : 'Synthetic native ↔ EVM mapping fixture matches.', 'Runtime-derived mapping', wrong ? 'Resolve the target network first.' : ''),
      item('account.balance', 'Testnet funding', wrong ? 'blocked' : 'passed', wrong ? 'No target-chain balance collected.' : 'Synthetic funded account fixture.', 'Funded test account', wrong ? 'Resolve the target network first.' : ''),
      item('contract.code', 'Deployed contract', wrong ? 'blocked' : missing ? 'failed' : 'passed', wrong ? 'Contract checks skipped on wrong network.' : missing ? 'Fixture target address has no deployed code.' : 'Synthetic probe code fixture exists.', 'Non-empty code on target network', wrong ? 'Resolve the target network first.' : missing ? 'Deploy the probe, save its address, then rerun. In rehearsal, select Corrected configuration.' : ''),
      item('contract.value', 'Contract state', wrong || missing ? 'blocked' : 'passed', wrong || missing ? 'No verified target contract to read.' : `Synthetic value matches ${project.expectedValue}.`, project.expectedValue, wrong || missing ? 'Resolve network and deployment before checking state.' : ''),
      item('transaction.finality', 'Write and readback receipt', wrong || missing ? 'blocked' : 'passed', wrong || missing ? 'No fixture cycle to verify.' : 'Synthetic fixture cycle completed. No real transaction was submitted.', 'A confirmed write followed by matching readback', wrong || missing ? 'Complete the earlier checks first.' : ''),
    ],
    limitations: ['This is a deterministic local rehearsal using synthetic data. It does not query, deploy to, or sign on Portaldot.', 'A passed rehearsal proves the product workflow only. It is not testnet deployment evidence.', 'No fixture transaction hash or contract address is presented as a blockchain receipt.'],
  };
}
