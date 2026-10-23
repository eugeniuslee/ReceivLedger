// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice UNIVERSITY SIMULATION ONLY. No ETH, SGD, stablecoin or external asset moves.
/// @dev Independent deployment; never a proxy/upgrade/migration of ReceivLedger V1.
contract ReceivLedgerV2 is ERC20, Ownable2Step, Pausable {
    error PolicyViolation(uint16 rule);
    uint256 public constant MAX_FUND_CENTS = 1_000_000_000;
    uint256 public constant SME_CAP_CENTS = 10_000_000;
    uint256 public constant AUTO_SME_CAP_CENTS = 5_000_000;
    uint256 public constant MAX_ACTIVE_LOANS = 100;
    uint256 public constant PROCESSING_FEE_CENTS = 2_000;
    uint256 public constant YEAR_BPS = 365 days * 10_000;
    uint256 public constant ANNUAL_BPS = 800;
    uint256 public smallSubscriptionCents = 1_000_000;
    uint256 public smallInvoiceCents = 500_000;
    uint16 public newInvoiceOverdueBps; // Optional 3% maximum; disabled by default.
    bool public automationEnabled;
    mapping(address => bool) public executors;
    mapping(address => bool) public invoiceAttestors;
    mapping(address => bool) private investorWallets;
    enum RegistrationStatus { PendingReview, MoreInformationRequired, Rejected, Approved, Suspended, Revoked }
    mapping(address => bytes32) public investorEntities;
    mapping(bytes32 => RegistrationStatus) public investorStatus;
    mapping(bytes32 => RegistrationStatus) public smeStatus;
    mapping(bytes32 => uint256) public automaticSubscriptionCents;
    mapping(bytes32 => uint256) public entityCommitmentsCents;
    mapping(bytes32 => uint256) public entityAutoExposureCents;
    mapping(bytes32 => uint256) public entityAutoCommitmentsCents;
    mapping(bytes32 => uint256) public payerCommitmentsCents;
    uint256 public financingCommitmentsCents;
    uint256 public bookedAccruedCents;
    uint256 public earnedInterestCents;
    uint256[] private activeLoans;
    mapping(uint256 => uint256) private activeIndex;
    mapping(address => bool) public verifiedSmes;
    mapping(address => bytes32) public smeEntities;
    mapping(bytes32 => uint256) public entityExposureCents;

    uint256 public liquidCents;
    uint256 public outstandingCents;
    uint256 public impairmentCents;
    uint256 public reservedRedemptionCents;
    uint256 public reservedRedemptionUnits;
    uint256 public pendingSubscriptionCents; // Segregated, not fund NAV/liquidity.
    uint256 public smeReservePoolCents; // Segregated payer surplus, not fund NAV.
    uint256 public processingIncomeCents;
    uint256 public collectedInterestCents;
    uint256 public collectedBaseInterestCents;
    uint256 public collectedOverdueInterestCents;
    uint256 public netAdvancedCents;
    uint256 public principalCollectedCents;
    uint256 public totalSubscribedCents;
    uint256 public totalRedeemedCents;
    uint256 public valuationValidUntil;
    mapping(address => uint256) public smeExposureCents;
    mapping(bytes32 => uint256) public payerExposureCents;
    mapping(bytes32 => bool) public usedDocuments;
    mapping(bytes32 => bool) public usedInvoiceReferences;
    mapping(uint256 => bytes32) private invoiceReferences;
    mapping(bytes32 => bool) public usedFundingReferences;
    mapping(bytes32 => bool) public usedCollectionReferences;
    mapping(bytes32 => bool) private usedRequestNonces;
    bool private escrowMove;

    enum SubscriptionStatus { PendingFunding, PendingReview, Ready, Processed, Cancelled, RefundPending, Refunded, Rejected }
    struct Subscription { address investor; uint256 cents; uint256 minimumUnits; bool funded; bool reviewed; SubscriptionStatus status; bytes32 entity; }
    uint256 public subscriptionCount;
    mapping(uint256 => Subscription) public subscriptions;
    enum RedemptionStatus { PendingReview, PendingLiquidity, Approved, Settled, Cancelled, Rejected }
    struct Redemption { address investor; uint256 units; uint256 minimumCents; uint256 payoutCents; RedemptionStatus status; }
    uint256 public redemptionCount;
    mapping(uint256 => Redemption) public redemptions;
    enum InvoiceStatus { Submitted, AutoApproved, Approved, Financed, Rejected, Repaid }
    struct Invoice {
        address sme; bytes32 entity; bytes32 payer; bytes32 document; uint256 face; uint256 advance;
        uint256 maturity; uint256 fundedAt; uint256 lastAccrual; uint256 principal;
        uint256 interest; uint256 overdue; uint256 interestRemainder; uint256 overdueRemainder;
        uint256 payerCollected; uint256 reservePayable; uint256 reserveReleased; uint256 impairment;
        uint16 overdueBps; bool attested; bool lowRisk; bool creditCleared; InvoiceStatus status;
        uint256 collectedBase; uint256 collectedOverdue; uint256 smeCollected;
        bool automatic; bool highRiskAcknowledged; uint256 commitment;
    }
    uint256 public invoiceCount;
    mapping(uint256 => Invoice) public invoices;

    struct InvoiceAccounting {
        uint256 netCashAdvancedCents; uint256 feeIncomeCents; uint256 principalReceivableCents;
        uint256 accruedBaseCents; uint256 accruedOverdueCents;
        uint256 collectedBaseCents; uint256 collectedOverdueCents; uint256 collectedPrincipalCents;
        uint256 payerCollectionsCents; uint256 smeCollectionsCents;
        uint256 reservePayableCents; uint256 reserveReleasedCents; uint256 impairmentCents;
    }

    event PermissionChanged(address indexed operator, bool execute, bool attest);
    event ParticipantVerified(address indexed wallet, bool investor, bool approved);
    event SmeEntityVerified(address indexed wallet, bytes32 indexed entity, bool approved);
    event AutomationConfigured(bool enabled, uint256 subscriptionLimit, uint256 invoiceLimit, uint16 overdueBps);
    event SubscriptionChanged(uint256 indexed id, SubscriptionStatus status, uint256 cents, uint256 units, bytes32 refId);
    event RedemptionChanged(uint256 indexed id, RedemptionStatus status, uint256 units, uint256 cents);
    event RedemptionRejected(uint256 indexed id, string reason);
    event InvoiceChanged(uint256 indexed id, InvoiceStatus status, uint256 principal, string reason);
    event InvoiceAttested(uint256 indexed id, bool lowRisk, bool creditCleared);
    event CollectionRecorded(uint256 indexed id, bytes32 indexed refId, bool payer, uint256 cents, uint256 interest, uint256 principal, uint256 surplus);
    event ReserveReleased(uint256 indexed id, uint256 cents);
    event ValuationConfirmed(uint256 validUntil, uint256 nav, uint256 units);
    event ImpairmentChanged(uint256 indexed id, uint256 cents);
    event RegistrationChanged(address indexed wallet, bytes32 indexed entity, bool investor, RegistrationStatus status);
    event ConcentrationAcknowledged(uint256 indexed id, bytes32 indexed entity, uint256 exposure, uint256 nav);
    /// @dev Capital flows are separate from income. Signed impacts are cents; receipt supplies transaction hash.
    event NavMovement(uint256 timestamp, uint256 indexed refId, bytes32 indexed kind, int256 cash, int256 loans, int256 income, int256 nav);

    function _movement(uint256 refId, bytes32 kind, int256 cash, int256 loans, int256 income, int256 nav) private {
        emit NavMovement(block.timestamp, refId, kind, cash, loans, income, nav);
    }

    constructor(address manager) ERC20("ReceivLedger V2 Simulated Unit", "RLU2") Ownable(manager) {}
    function decimals() public pure override returns (uint8) { return 2; }
    function renounceOwnership() public view override onlyOwner { revert("Manager required"); }
    modifier onlyExecutorOrOwner() { require(msg.sender == owner() || executors[msg.sender], PolicyViolation(1)); _; }
    function setOperator(address operator, bool execute, bool attest) external onlyOwner {
        require(operator != address(0) && operator != address(this), PolicyViolation(2));
        executors[operator] = execute; invoiceAttestors[operator] = attest;
        emit PermissionChanged(operator, execute, attest);
    }
    function setParticipant(address wallet, bool investor, bool approved) external onlyOwner {
        require(wallet != address(0) && wallet != address(this), PolicyViolation(3));
        require(investor && investorEntities[wallet] != 0 && wallet != owner(), PolicyViolation(4)); investorWallets[wallet] = approved;
        emit ParticipantVerified(wallet, investor, approved);
    }
    function investors(address wallet) public view returns (bool) {
        return wallet != owner() && investorWallets[wallet] && investorEntities[wallet] != 0 && investorStatus[investorEntities[wallet]] == RegistrationStatus.Approved;
    }
    function setInvestor(address wallet, bytes32 entity, RegistrationStatus status) external onlyOwner {
        require(wallet != address(0) && wallet != address(this) && wallet != owner() && entity != 0, PolicyViolation(5));
        require(investorEntities[wallet] == 0 || investorEntities[wallet] == entity, PolicyViolation(6));
        investorEntities[wallet] = entity; investorStatus[entity] = status; investorWallets[wallet] = status == RegistrationStatus.Approved;
        emit RegistrationChanged(wallet, entity, true, status);
    }
    function setSme(address wallet, bytes32 entity, bool approved) external onlyOwner {
        require(wallet != address(0) && wallet != address(this) && wallet != owner() && entity != 0, PolicyViolation(7));
        require(smeEntities[wallet] == 0 || smeEntities[wallet] == entity, PolicyViolation(6));
        smeEntities[wallet] = entity; verifiedSmes[wallet] = approved;
        smeStatus[entity] = approved ? RegistrationStatus.Approved : RegistrationStatus.PendingReview;
        emit SmeEntityVerified(wallet, entity, approved);
    }
    function setSmeStatus(bytes32 entity, RegistrationStatus status) external onlyOwner {
        require(entity != 0, PolicyViolation(8)); smeStatus[entity] = status;
        emit RegistrationChanged(address(0), entity, false, status);
    }
    function configureAutomation(bool enabled, uint256 subscriptionLimit, uint256 invoiceLimit, uint16 lateBps) external onlyOwner {
        require(subscriptionLimit <= 1_000_000 && invoiceLimit <= 500_000 && lateBps <= 300, PolicyViolation(9));
        automationEnabled = enabled; smallSubscriptionCents = subscriptionLimit; smallInvoiceCents = invoiceLimit;
        newInvoiceOverdueBps = lateBps;
        emit AutomationConfigured(enabled, subscriptionLimit, invoiceLimit, lateBps);
    }
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
    function accruedInterestCents() public view returns (uint256 total) {
        total = bookedAccruedCents;
        for (uint256 n; n < activeLoans.length; n++) {
            (uint256 base, uint256 late,,) = _newAccrual(invoices[activeLoans[n]]); total += base + late;
        }
    }
    function _checkpointInterest() private {
        for (uint256 n; n < activeLoans.length; n++) {
            uint256 id = activeLoans[n]; Invoice storage i = invoices[id];
            (uint256 base, uint256 late, uint256 br, uint256 lr) = _newAccrual(i);
            i.interest += base; i.overdue += late; i.interestRemainder = br; i.overdueRemainder = lr; i.lastAccrual = block.timestamp;
            bookedAccruedCents += base + late; earnedInterestCents += base + late;
            if (base + late != 0) _movement(id, "InterestAccrued", 0, int256(base + late), int256(base + late), int256(base + late));
        }
    }
    function fundAssetsCents() public view returns (uint256) { return liquidCents + outstandingCents + accruedInterestCents() - impairmentCents; }
    function custodialAssetsCents() external view returns (uint256) { return fundAssetsCents() + pendingSubscriptionCents + smeReservePoolCents; }
    function fundLiabilitiesCents() external view returns (uint256) { return reservedRedemptionCents + pendingSubscriptionCents + smeReservePoolCents; }
    function navCents() public view returns (uint256) { return fundAssetsCents() - reservedRedemptionCents; }
    function pricingUnits() public view returns (uint256) { return totalSupply() - reservedRedemptionUnits; }
    function freeLiquidityCents() public view returns (uint256) { return liquidCents - reservedRedemptionCents - financingCommitmentsCents; }
    /// @notice Simulated cash held, including segregated balances. Redemption reserves already belong to liquidCents.
    function custodialCashCents() external view returns (uint256) { return liquidCents + pendingSubscriptionCents + smeReservePoolCents; }
    function confirmValuation(uint256 validUntil) external onlyOwner {
        require(validUntil > block.timestamp && validUntil <= block.timestamp + 1 days, PolicyViolation(10));
        valuationValidUntil = validUntil; emit ValuationConfirmed(validUntil, navCents(), pricingUnits());
    }
    function requireValuation() private view {
        if (outstandingCents + accruedInterestCents() != 0) require(valuationValidUntil >= block.timestamp, PolicyViolation(11));
        require(pricingUnits() == 0 || navCents() != 0, PolicyViolation(12));
    }
    function subscriptionUnits(uint256 cents) public view returns (uint256) {
        requireValuation();
        if (pricingUnits() == 0) { require(navCents() == 0, PolicyViolation(13)); return cents; }
        return Math.mulDiv(cents, pricingUnits(), navCents());
    }
    function redemptionValue(uint256 units) public view returns (uint256) {
        requireValuation(); require(pricingUnits() != 0 && units <= pricingUnits(), PolicyViolation(14));
        return Math.mulDiv(units, navCents(), pricingUnits());
    }
    function requestSubscription(uint256 cents, uint256 minimumUnits, bytes32 nonce) external whenNotPaused returns (uint256 id) {
        require(investors(msg.sender) && cents >= 100 && cents <= MAX_FUND_CENTS, PolicyViolation(15));
        require(fundAssetsCents() + cents <= MAX_FUND_CENTS, PolicyViolation(16));
        bytes32 key = keccak256(abi.encode(msg.sender, nonce));
        require(nonce != bytes32(0) && !usedRequestNonces[key], PolicyViolation(17)); usedRequestNonces[key] = true;
        require(minimumUnits > 0, PolicyViolation(18));
        id = ++subscriptionCount; subscriptions[id] = Subscription(msg.sender, cents, minimumUnits, false, false, SubscriptionStatus.PendingFunding, investorEntities[msg.sender]);
        emit SubscriptionChanged(id, SubscriptionStatus.PendingFunding, cents, 0, nonce);
    }
    function confirmSubscriptionFunding(uint256 id, bytes32 refId) external onlyOwner {
        Subscription storage s = subscriptions[id];
        require(s.investor != address(0) && s.status == SubscriptionStatus.PendingFunding && !s.funded, PolicyViolation(19));
        require(refId != bytes32(0) && !usedFundingReferences[refId] && !usedCollectionReferences[refId], PolicyViolation(20));
        usedFundingReferences[refId] = true; s.funded = true; pendingSubscriptionCents += s.cents;
        s.status = s.cents + automaticSubscriptionCents[s.entity] <= smallSubscriptionCents || s.reviewed ? SubscriptionStatus.Ready : SubscriptionStatus.PendingReview;
        emit SubscriptionChanged(id, s.status, s.cents, 0, refId);
    }
    function approveSubscription(uint256 id) external onlyOwner {
        Subscription storage s = subscriptions[id];
        require(s.investor != address(0) && (s.status == SubscriptionStatus.PendingFunding || s.status == SubscriptionStatus.PendingReview || s.status == SubscriptionStatus.Ready), PolicyViolation(21));
        s.reviewed = true; if (s.funded) s.status = SubscriptionStatus.Ready;
        emit SubscriptionChanged(id, s.status, s.cents, 0, 0);
    }
    function processSubscription(uint256 id) external onlyExecutorOrOwner whenNotPaused {
        _checkpointInterest();
        Subscription storage s = subscriptions[id];
        require(s.status == SubscriptionStatus.Ready && s.funded && investors(s.investor) && s.entity == investorEntities[s.investor], PolicyViolation(22));
        require(s.reviewed || s.cents + automaticSubscriptionCents[s.entity] <= smallSubscriptionCents, PolicyViolation(23));
        if (msg.sender != owner()) require(automationEnabled, PolicyViolation(24));
        require(fundAssetsCents() + s.cents <= MAX_FUND_CENTS, PolicyViolation(16));
        uint256 units = subscriptionUnits(s.cents); require(units > 0 && units >= s.minimumUnits, PolicyViolation(25));
        s.status = SubscriptionStatus.Processed; pendingSubscriptionCents -= s.cents; liquidCents += s.cents;
        totalSubscribedCents += s.cents; _mint(s.investor, units);
        if (!s.reviewed) automaticSubscriptionCents[s.entity] += s.cents;
        _movement(id, "Subscription", int256(s.cents), 0, 0, int256(s.cents));
        emit SubscriptionChanged(id, s.status, s.cents, units, 0);
    }
    function cancelSubscription(uint256 id) external {
        Subscription storage s = subscriptions[id];
        require(s.investor == msg.sender && !s.funded && s.status == SubscriptionStatus.PendingFunding, PolicyViolation(26));
        s.status = SubscriptionStatus.Cancelled; emit SubscriptionChanged(id, s.status, s.cents, 0, 0);
    }
    function rejectSubscription(uint256 id) external onlyOwner {
        Subscription storage s = subscriptions[id];
        require(s.investor != address(0) && uint8(s.status) <= uint8(SubscriptionStatus.Ready), PolicyViolation(27));
        s.status = s.funded ? SubscriptionStatus.RefundPending : SubscriptionStatus.Rejected;
        emit SubscriptionChanged(id, s.status, s.cents, 0, 0);
    }
    function recordSubscriptionRefund(uint256 id, bytes32 refId) external onlyOwner {
        Subscription storage s = subscriptions[id]; require(s.status == SubscriptionStatus.RefundPending, PolicyViolation(28));
        require(refId != bytes32(0) && !usedFundingReferences[refId] && !usedCollectionReferences[refId], PolicyViolation(29)); usedFundingReferences[refId] = true;
        pendingSubscriptionCents -= s.cents; s.status = SubscriptionStatus.Refunded;
        emit SubscriptionChanged(id, s.status, s.cents, 0, refId);
    }
    function requestRedemption(uint256 units, uint256 minimumCents) external returns (uint256 id) {
        require(investors(msg.sender), PolicyViolation(30));
        require(units != 0 && units <= balanceOf(msg.sender), PolicyViolation(31));
        escrowMove = true; _transfer(msg.sender, address(this), units); escrowMove = false;
        id = ++redemptionCount; redemptions[id] = Redemption(msg.sender, units, minimumCents, 0, RedemptionStatus.PendingReview);
        emit RedemptionChanged(id, RedemptionStatus.PendingReview, units, 0);
    }
    function approveRedemption(uint256 id) external onlyOwner { _allocateRedemption(id, false); }
    function allocateRedemption(uint256 id) external onlyExecutorOrOwner { _allocateRedemption(id, true); }
    function _allocateRedemption(uint256 id, bool previouslyReviewed) private {
        _checkpointInterest();
        Redemption storage r = redemptions[id];
        require(investors(r.investor), PolicyViolation(30));
        require(r.investor != address(0) && (r.status == RedemptionStatus.PendingReview || r.status == RedemptionStatus.PendingLiquidity), PolicyViolation(32));
        if (previouslyReviewed) require(r.status == RedemptionStatus.PendingLiquidity, PolicyViolation(23));
        if (msg.sender != owner()) require(automationEnabled, PolicyViolation(24));
        uint256 cents = redemptionValue(r.units); require(cents > 0 && cents >= r.minimumCents, PolicyViolation(33));
        // Keep an active residual owner for unresolved receivables, including fully impaired loans.
        // Otherwise a later recovery can strand positive NAV behind zero pricing units.
        bool finalExitWithLoans = r.units == pricingUnits() && (outstandingCents != 0 || accruedInterestCents() != 0 || financingCommitmentsCents != 0);
        if (cents > freeLiquidityCents() || finalExitWithLoans) { r.status = RedemptionStatus.PendingLiquidity; emit RedemptionChanged(id, r.status, r.units, 0); return; }
        r.status = RedemptionStatus.Approved; r.payoutCents = cents;
        reservedRedemptionCents += cents; reservedRedemptionUnits += r.units;
        _movement(id, "RedemptionAllocated", 0, 0, 0, -int256(cents));
        emit RedemptionChanged(id, r.status, r.units, cents);
    }
    function settleRedemption(uint256 id) external onlyExecutorOrOwner {
        _checkpointInterest();
        if (msg.sender != owner()) require(automationEnabled, PolicyViolation(24));
        Redemption storage r = redemptions[id]; require(r.investor != address(0) && r.status == RedemptionStatus.Approved, PolicyViolation(34));
        r.status = RedemptionStatus.Settled; reservedRedemptionCents -= r.payoutCents; reservedRedemptionUnits -= r.units;
        liquidCents -= r.payoutCents; totalRedeemedCents += r.payoutCents; _burn(address(this), r.units);
        _movement(id, "RedemptionSettled", -int256(r.payoutCents), 0, 0, 0);
        emit RedemptionChanged(id, r.status, r.units, r.payoutCents);
    }
    function cancelRedemption(uint256 id) external {
        Redemption storage r = redemptions[id]; require(r.investor == msg.sender, PolicyViolation(35));
        require(r.status == RedemptionStatus.PendingReview || r.status == RedemptionStatus.PendingLiquidity, PolicyViolation(36));
        r.status = RedemptionStatus.Cancelled; escrowMove = true; _transfer(address(this), r.investor, r.units); escrowMove = false;
        emit RedemptionChanged(id, r.status, r.units, 0);
    }
    function rejectRedemption(uint256 id, string calldata reason) external onlyOwner {
        Redemption storage r = redemptions[id]; require(bytes(reason).length > 0 && bytes(reason).length <= 200, PolicyViolation(37));
        require(r.investor != address(0) && (r.status == RedemptionStatus.PendingReview || r.status == RedemptionStatus.PendingLiquidity), PolicyViolation(36));
        r.status = RedemptionStatus.Rejected; escrowMove = true; _transfer(address(this), r.investor, r.units); escrowMove = false;
        emit RedemptionChanged(id, r.status, r.units, 0); emit RedemptionRejected(id, reason);
    }
    function submitInvoice(bytes32 payer, bytes32 document, bytes32 refId, uint256 face, uint256 maturity, uint16 acceptedLateBps) external whenNotPaused returns (uint256 id) {
        require(msg.sender != owner() && verifiedSmes[msg.sender] && smeStatus[smeEntities[msg.sender]] == RegistrationStatus.Approved && payer != 0 && document != 0 && refId != 0, PolicyViolation(38));
        require(!usedDocuments[document] && !usedInvoiceReferences[refId], PolicyViolation(39));
        require(face > PROCESSING_FEE_CENTS && face <= SME_CAP_CENTS * 100 / 90, PolicyViolation(40));
        require(maturity > block.timestamp && maturity <= block.timestamp + 90 days, PolicyViolation(41));
        require(acceptedLateBps == newInvoiceOverdueBps, PolicyViolation(42));
        usedDocuments[document] = true; usedInvoiceReferences[refId] = true;
        id = ++invoiceCount; Invoice storage i = invoices[id];
        invoiceReferences[id] = refId;
        i.sme = msg.sender; i.entity = smeEntities[msg.sender]; i.payer = payer; i.document = document; i.face = face;
        i.advance = face <= 500_000 ? face : face * 90 / 100;
        i.maturity = maturity; i.overdueBps = acceptedLateBps;
        emit InvoiceChanged(id, InvoiceStatus.Submitted, 0, "Submitted; attestation required");
    }
    function attestInvoice(uint256 id, bool lowRisk, bool creditCleared) external {
        require(msg.sender == owner() || invoiceAttestors[msg.sender], PolicyViolation(43));
        Invoice storage i = invoices[id]; require(i.sme != address(0) && i.status == InvoiceStatus.Submitted, PolicyViolation(44));
        require(msg.sender != i.sme && smeEntities[msg.sender] != i.entity, PolicyViolation(45));
        i.attested = true; i.lowRisk = lowRisk; i.creditCleared = creditCleared;
        emit InvoiceAttested(id, lowRisk, creditCleared);
    }
    function _checkFinance(Invoice storage i) private view {
        require(i.sme != owner() && verifiedSmes[i.sme] && smeStatus[i.entity] == RegistrationStatus.Approved && i.attested && i.creditCleared, PolicyViolation(46));
        require(i.entity == smeEntities[i.sme], PolicyViolation(47));
        require(i.maturity > block.timestamp && i.maturity <= block.timestamp + 90 days, PolicyViolation(41));
        uint256 extra = i.commitment == 0 ? i.advance : 0;
        require(entityExposureCents[i.entity] + entityCommitmentsCents[i.entity] + extra <= SME_CAP_CENTS, PolicyViolation(48));
        require(payerExposureCents[i.payer] + payerCommitmentsCents[i.payer] + extra <= navCents() / 10, PolicyViolation(49));
        require(i.advance > PROCESSING_FEE_CENTS && i.advance - PROCESSING_FEE_CENTS <= freeLiquidityCents() + i.commitment, PolicyViolation(50));
    }
    function _projectedExposure(Invoice storage i) private view returns (uint256) {
        return entityExposureCents[i.entity] + entityCommitmentsCents[i.entity] + (i.commitment == 0 ? i.advance : 0);
    }
    function autoEligible(uint256 id) public view returns (bool) {
        Invoice storage i = invoices[id];
        uint256 extra = i.commitment == 0 ? i.advance : 0;
        return i.sme != address(0) && (i.status == InvoiceStatus.Submitted || i.status == InvoiceStatus.AutoApproved) && i.face <= smallInvoiceCents && _projectedExposure(i) <= navCents() / 100 && i.lowRisk && i.attested && i.creditCleared && verifiedSmes[i.sme] && smeStatus[i.entity] == RegistrationStatus.Approved
            && (_projectedExposure(i) * 100 < navCents() || i.highRiskAcknowledged)
            && i.maturity > block.timestamp && i.maturity <= block.timestamp + 30 days
            && i.entity == smeEntities[i.sme] && _projectedExposure(i) <= SME_CAP_CENTS
            && entityAutoExposureCents[i.entity] + entityAutoCommitmentsCents[i.entity] + extra <= AUTO_SME_CAP_CENTS
            && payerExposureCents[i.payer] + payerCommitmentsCents[i.payer] + extra <= navCents() / 10
            && i.advance - PROCESSING_FEE_CENTS <= freeLiquidityCents() + i.commitment;
    }
    function _reserveFinance(Invoice storage i, bool automatic) private {
        if (i.commitment != 0) _releaseCommitment(i);
        i.automatic = automatic; i.commitment = i.advance - PROCESSING_FEE_CENTS;
        entityCommitmentsCents[i.entity] += i.advance; payerCommitmentsCents[i.payer] += i.advance;
        financingCommitmentsCents += i.commitment;
        if (automatic) entityAutoCommitmentsCents[i.entity] += i.advance;
    }
    function _releaseCommitment(Invoice storage i) private {
        financingCommitmentsCents -= i.commitment; i.commitment = 0;
        entityCommitmentsCents[i.entity] -= i.advance; payerCommitmentsCents[i.payer] -= i.advance;
        if (i.automatic) entityAutoCommitmentsCents[i.entity] -= i.advance;
    }
    function approveSmallInvoice(uint256 id) external onlyExecutorOrOwner whenNotPaused {
        require(automationEnabled && autoEligible(id), PolicyViolation(51));
        Invoice storage i = invoices[id]; require(i.status == InvoiceStatus.Submitted, PolicyViolation(44)); _checkFinance(i);
        _reserveFinance(i, true); i.status = InvoiceStatus.AutoApproved; emit InvoiceChanged(id, i.status, 0, "Policy approved; not financed");
    }
    function approveInvoice(uint256 id) external onlyOwner whenNotPaused {
        Invoice storage i = invoices[id]; require(i.sme != address(0) && (i.status == InvoiceStatus.Submitted || i.status == InvoiceStatus.AutoApproved), PolicyViolation(21));
        _checkFinance(i);
        require(_projectedExposure(i) * 100 < navCents() || i.highRiskAcknowledged, PolicyViolation(52));
        _reserveFinance(i, false); i.status = InvoiceStatus.Approved; emit InvoiceChanged(id, i.status, 0, "Manager approved; not financed");
    }
    function acknowledgeConcentration(uint256 id) external onlyOwner {
        Invoice storage i = invoices[id]; require(i.sme != address(0) && uint8(i.status) <= uint8(InvoiceStatus.Approved), PolicyViolation(21));
        i.highRiskAcknowledged = true; emit ConcentrationAcknowledged(id, i.entity, _projectedExposure(i), navCents());
    }
    function rejectInvoice(uint256 id, string calldata reason) external onlyOwner {
        Invoice storage i = invoices[id]; require(i.sme != address(0) && (i.status == InvoiceStatus.Submitted || i.status == InvoiceStatus.AutoApproved || i.status == InvoiceStatus.Approved), PolicyViolation(21));
        require(bytes(reason).length > 0 && bytes(reason).length <= 200, PolicyViolation(37));
        if (i.commitment != 0) _releaseCommitment(i); i.status = InvoiceStatus.Rejected;
        // Rejected evidence is not a funded obligation. Release it so a revoked submitter
        // cannot permanently burn another SME's canonical invoice/document identifiers.
        usedDocuments[i.document] = false; usedInvoiceReferences[invoiceReferences[id]] = false;
        emit InvoiceChanged(id, i.status, 0, reason);
    }
    function financeInvoice(uint256 id) external onlyExecutorOrOwner whenNotPaused {
        _checkpointInterest();
        Invoice storage i = invoices[id]; require(i.sme != address(0) && (i.status == InvoiceStatus.Approved || i.status == InvoiceStatus.AutoApproved), PolicyViolation(53));
        if (msg.sender != owner()) require(automationEnabled, PolicyViolation(24));
        if (i.status == InvoiceStatus.AutoApproved) require(autoEligible(id), PolicyViolation(23));
        else require(_projectedExposure(i) * 100 < navCents() || i.highRiskAcknowledged, PolicyViolation(52));
        require(activeLoans.length < MAX_ACTIVE_LOANS, PolicyViolation(54));
        _checkFinance(i); i.status = InvoiceStatus.Financed; i.principal = i.advance;
        _releaseCommitment(i);
        i.fundedAt = block.timestamp; i.lastAccrual = block.timestamp;
        liquidCents -= i.advance - PROCESSING_FEE_CENTS; outstandingCents += i.advance;
        netAdvancedCents += i.advance - PROCESSING_FEE_CENTS;
        processingIncomeCents += PROCESSING_FEE_CENTS; smeExposureCents[i.sme] += i.advance; payerExposureCents[i.payer] += i.advance;
        entityExposureCents[i.entity] += i.advance;
        if (i.automatic) entityAutoExposureCents[i.entity] += i.advance;
        activeIndex[id] = activeLoans.length; activeLoans.push(id);
        _movement(id, "Financed", -int256(i.advance - PROCESSING_FEE_CENTS), int256(i.advance), int256(PROCESSING_FEE_CENTS), int256(PROCESSING_FEE_CENTS));
        valuationValidUntil = 0; emit InvoiceChanged(id, i.status, i.principal, "Net advance = gross less processing fee");
    }
    function _newAccrual(Invoice storage i) private view returns (uint256 base, uint256 late, uint256 baseRem, uint256 lateRem) {
        if (i.principal == 0 || i.fundedAt == 0) return (0, 0, i.interestRemainder, i.overdueRemainder);
        uint256 numerator = i.principal * ANNUAL_BPS * (block.timestamp - i.lastAccrual) + i.interestRemainder;
        base = numerator / YEAR_BPS; baseRem = numerator % YEAR_BPS;
        uint256 lateStart = Math.max(i.lastAccrual, i.maturity);
        numerator = i.overdueRemainder;
        if (block.timestamp > lateStart) numerator += i.principal * i.overdueBps * (block.timestamp - lateStart);
        late = numerator / YEAR_BPS; lateRem = numerator % YEAR_BPS;
    }
    function obligationCents(uint256 id) external view returns (uint256) {
        Invoice storage i = invoices[id]; require(i.sme != address(0), PolicyViolation(55));
        (uint256 base, uint256 late,,) = _newAccrual(i);
        return i.principal + i.interest + i.overdue + base + late;
    }
    /// @notice Current earned unpaid interest is included once in investment NAV; it is not cash.
    /// @dev Reads use block.timestamp; the raw getter contains only accrual stored at the last financial checkpoint.
    function invoiceAccounting(uint256 id) external view returns (InvoiceAccounting memory a) {
        Invoice storage i = invoices[id]; require(i.sme != address(0), PolicyViolation(55));
        (uint256 base, uint256 late,,) = _newAccrual(i);
        bool financed = i.fundedAt != 0;
        a.netCashAdvancedCents = financed ? i.advance - PROCESSING_FEE_CENTS : 0;
        a.feeIncomeCents = financed ? PROCESSING_FEE_CENTS : 0;
        a.principalReceivableCents = i.principal;
        a.accruedBaseCents = i.interest + base; a.accruedOverdueCents = i.overdue + late;
        a.collectedBaseCents = i.collectedBase; a.collectedOverdueCents = i.collectedOverdue;
        a.collectedPrincipalCents = financed ? i.advance - i.principal : 0;
        a.payerCollectionsCents = i.payerCollected; a.smeCollectionsCents = i.smeCollected;
        a.reservePayableCents = i.reservePayable; a.reserveReleasedCents = i.reserveReleased;
        a.impairmentCents = i.impairment;
    }
    /// @notice Bounded live accrued-unpaid totals. Pin all pages to one block when aggregating a whole fund.
    function accruedInterestPage(uint256 firstId, uint256 limit) external view returns (uint256 nextId, uint256 baseCents, uint256 overdueCents) {
        require(firstId > 0 && firstId <= invoiceCount + 1 && limit > 0 && limit <= 100, PolicyViolation(56));
        nextId = Math.min(firstId + limit, invoiceCount + 1);
        for (uint256 id = firstId; id < nextId; id++) {
            Invoice storage i = invoices[id]; (uint256 base, uint256 late,,) = _newAccrual(i);
            baseCents += i.interest + base; overdueCents += i.overdue + late;
        }
    }
    function recordCollection(uint256 id, uint256 cents, bool fromPayer, bytes32 refId) external onlyOwner {
        _checkpointInterest();
        Invoice storage i = invoices[id]; require(i.sme != address(0) && (i.status == InvoiceStatus.Financed || (i.status == InvoiceStatus.Repaid && fromPayer)), PolicyViolation(57));
        require(cents > 0 && refId != 0 && !usedCollectionReferences[refId] && !usedFundingReferences[refId], PolicyViolation(58));
        if (fromPayer) { require(i.payerCollected + cents <= i.face, PolicyViolation(59)); i.payerCollected += cents; }
        else { require(cents <= i.principal + i.interest + i.overdue, PolicyViolation(60)); i.smeCollected += cents; }
        usedCollectionReferences[refId] = true;
        uint256 remaining = cents; uint256 interestPaid = Math.min(remaining, i.interest); remaining -= interestPaid; i.interest -= interestPaid;
        uint256 latePaid = Math.min(remaining, i.overdue); remaining -= latePaid; i.overdue -= latePaid;
        uint256 principalPaid = Math.min(remaining, i.principal); remaining -= principalPaid; i.principal -= principalPaid;
        i.collectedBase += interestPaid; i.collectedOverdue += latePaid;
        collectedBaseInterestCents += interestPaid; collectedOverdueInterestCents += latePaid;
        principalCollectedCents += principalPaid;
        bookedAccruedCents -= interestPaid + latePaid;
        outstandingCents -= principalPaid; smeExposureCents[i.sme] -= principalPaid; payerExposureCents[i.payer] -= principalPaid;
        entityExposureCents[i.entity] -= principalPaid;
        if (i.automatic) entityAutoExposureCents[i.entity] -= principalPaid;
        uint256 recoveredLoss;
        if (i.impairment > i.principal + i.interest + i.overdue) { recoveredLoss = i.impairment - i.principal - i.interest - i.overdue; impairmentCents -= recoveredLoss; i.impairment -= recoveredLoss; }
        i.reservePayable += remaining; smeReservePoolCents += remaining;
        liquidCents += cents - remaining; collectedInterestCents += interestPaid + latePaid; valuationValidUntil = 0;
        if (i.principal == 0 && i.interest == 0 && i.overdue == 0 && i.status != InvoiceStatus.Repaid) {
            i.status = InvoiceStatus.Repaid; i.interestRemainder = 0; i.overdueRemainder = 0;
            uint256 index = activeIndex[id]; uint256 last = activeLoans[activeLoans.length - 1];
            activeLoans[index] = last; activeIndex[last] = index; activeLoans.pop(); delete activeIndex[id];
        }
        _movement(id, "Collection", int256(cents - remaining), -int256(principalPaid + interestPaid + latePaid), int256(recoveredLoss), int256(recoveredLoss));
        emit CollectionRecorded(id, refId, fromPayer, cents, interestPaid + latePaid, principalPaid, remaining);
        emit InvoiceChanged(id, i.status, i.principal, "Collection applied once; surplus segregated");
    }
    function releaseReserve(uint256 id) external onlyOwner {
        Invoice storage i = invoices[id]; require(i.status == InvoiceStatus.Repaid && i.reservePayable > 0, PolicyViolation(61));
        uint256 cents = i.reservePayable; i.reservePayable = 0; i.reserveReleased += cents; smeReservePoolCents -= cents;
        emit ReserveReleased(id, cents);
    }
    function setImpairment(uint256 id, uint256 cents) external onlyOwner {
        _checkpointInterest();
        Invoice storage i = invoices[id]; require(i.sme != address(0) && cents <= i.principal + i.interest + i.overdue, PolicyViolation(62));
        int256 impact = int256(i.impairment) - int256(cents);
        impairmentCents = impairmentCents - i.impairment + cents; i.impairment = cents; valuationValidUntil = 0;
        _movement(id, "Impairment", 0, 0, impact, impact);
        emit ImpairmentChanged(id, cents);
    }
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            if (from == address(this) || to == address(this)) require(escrowMove, PolicyViolation(63));
            else require(investors(from) && investors(to), PolicyViolation(64));
        }
        super._update(from, to, value);
    }
}
