// SIMULATED data only. Wallet labels are demo-only; the contract stores addresses only.
export const MGR='0x5B38Da6a701c568545dCfcB03FcB875f56beddC4';
export const W={sme:'0x4B20993Bc481177ec7E8f571ceCaE8A9e022d390',inv:'0x78731D3Ca6b7E34aC0F824c42a7c18a495cabaB2'};
export const NAMES:Record<string,string>={[MGR]:'Fund manager',[W.sme]:'Kallang Print Works',
 '0x1aE0EE5f2C7A4f3a8D1b9e5C0F4b6d7E8a9C0b11':'Pasir Ris Foods','0x2bF1FF6a3D8B5a4b9E2c0f6D1a5c7e8F9b0D1c22':'Tuas Precision Eng.','0x3cA2AA7b4E9C6b5c0F3d1a7E2b6d8f9A0c1E2d33':'Orchard Design Studio'};
export const INV0:[string,string][]=[['Meridian Family Office',W.inv],['Harbourline Capital','0x9a1D85641CE6c0e2F4B7aD3E6f0c8b5A71d2E4c3'],['Orchid Wealth','0xAb8483F64d9C6d1EcF9b6e366c2E3d4f5A6b7C88'],['Tanjong Ventures','0x617F2E2fD72FE9e5aC9bF8e2A1d3C4b5E6f7A099'],['Kestrel Partners','0xdD870fA1b7C4700F2BD7f44238821C1fE2d3b5a0']];
export const ROLES: Record<string, string> = {'Fund manager':MGR,'SME wallet':W.sme,'Investor wallet':W.inv};
