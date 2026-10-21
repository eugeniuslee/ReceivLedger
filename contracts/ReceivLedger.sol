// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ReceivLedger is ERC20 {

    // Address that deployed the contract
    address public manager;


    // Runs automatically when the contract is deployed
    constructor() ERC20("ReceivLedger Fund Unit", "RLU") {
        manager = msg.sender;
    }


    // Restricts certain functions to the fund manager
    modifier onlyManager() {
        require(
            msg.sender == manager,
            "Only manager can perform this action"
        );
        _;
    }


    // =====================================================
    // FUND INFORMATION
    // =====================================================

    // Total simulated capital invested into the fund
    uint256 public totalFundSize;

    // Simulated capital currently available to finance invoices
    uint256 public availableFunds;

    // Maximum exposure to one payer = 10%
    uint256 public constant MAX_PAYER_EXPOSURE_PERCENT = 10;

    // Maximum remaining invoice maturity = 90 days
    uint256 public constant MAX_MATURITY_DAYS = 90;

    // Maximum simulated fund size = S$1 million
    uint256 public constant MAX_FUND_SIZE = 1_000_000;


    // =====================================================
    // INVESTORS
    // =====================================================

    // Whether an investor wallet is approved
    mapping(address => bool) public approvedInvestors;


    // =====================================================
    // INVOICE INFORMATION
    // =====================================================

    enum InvoiceStatus {
        Submitted,
        Approved,
        Financed,
        Rejected,
        Repaid
    }

    struct Invoice {
        uint256 id;
        address sme;
        string payerName;
        uint256 amount;
        uint256 maturityDate;
        InvoiceStatus status;
        string rejectionReason;
    }

    // Number of invoices submitted
    uint256 public invoiceCount;

    // Stores each invoice using its ID
    mapping(uint256 => Invoice) public invoices;

    // Tracks outstanding financing exposure for each payer
    mapping(bytes32 => uint256) private payerExposure;


    // =====================================================
    // EVENTS
    // =====================================================

    event InvestorApproved(address investor);

    event InvestorRevoked(address investor);

    event FundUnitsIssued(
        address investor,
        uint256 amount
    );

    event InvoiceSubmitted(
        uint256 invoiceId,
        address sme,
        string payerName,
        uint256 amount
    );

    event InvoiceApproved(
        uint256 invoiceId
    );

    event InvoiceFinanced(
        uint256 invoiceId,
        uint256 amount
    );

    event InvoiceRejected(
        uint256 invoiceId,
        string reason
    );

    event InvoiceRepaid(
        uint256 invoiceId,
        uint256 amount
    );


    // =====================================================
    // APPROVE INVESTOR
    // =====================================================

    function approveInvestor(address investor)
        public
        onlyManager
    {
        require(
            investor != address(0),
            "Invalid investor address"
        );

        approvedInvestors[investor] = true;

        emit InvestorApproved(investor);
    }


    // =====================================================
    // REVOKE INVESTOR
    // =====================================================

    function revokeInvestor(address investor)
        public
        onlyManager
    {
        require(
            approvedInvestors[investor],
            "Investor is not approved"
        );

        approvedInvestors[investor] = false;

        emit InvestorRevoked(investor);
    }


    // =====================================================
    // ISSUE ERC-20 FUND UNITS
    // =====================================================

    function issueFundUnits(
        address investor,
        uint256 amount
    )
        public
        onlyManager
    {
        require(
            approvedInvestors[investor],
            "Investor is not approved"
        );

        require(
            amount > 0,
            "Amount must be greater than zero"
        );

        require(
            totalFundSize + amount <= MAX_FUND_SIZE,
            "Maximum fund size exceeded"
        );

        // Mint ERC-20 ReceivLedger Fund Units
        _mint(investor, amount);

        totalFundSize += amount;

        availableFunds += amount;

        emit FundUnitsIssued(
            investor,
            amount
        );
    }


    // =====================================================
    // SUBMIT INVOICE
    // =====================================================

    function submitInvoice(
        string memory payerName,
        uint256 amount,
        uint256 maturityDate
    )
        public
        returns (uint256)
    {
        require(
            bytes(payerName).length > 0,
            "Payer name is required"
        );

        require(
            amount > 0,
            "Invoice amount must be greater than zero"
        );

        require(
            maturityDate > block.timestamp,
            "Maturity date must be in the future"
        );

        invoiceCount++;

        invoices[invoiceCount] = Invoice({
            id: invoiceCount,
            sme: msg.sender,
            payerName: payerName,
            amount: amount,
            maturityDate: maturityDate,
            status: InvoiceStatus.Submitted,
            rejectionReason: ""
        });

        emit InvoiceSubmitted(
            invoiceCount,
            msg.sender,
            payerName,
            amount
        );

        return invoiceCount;
    }


    // =====================================================
    // APPROVE INVOICE
    // =====================================================

    function approveInvoice(
        uint256 invoiceId
    )
        public
        onlyManager
    {
        Invoice storage invoice = invoices[invoiceId];

        require(
            invoice.id != 0,
            "Invoice does not exist"
        );

        require(
            invoice.status == InvoiceStatus.Submitted,
            "Invoice is not awaiting approval"
        );

        // Represents successful off-chain verification
        // and credit assessment
        invoice.status = InvoiceStatus.Approved;

        emit InvoiceApproved(invoiceId);
    }


    // =====================================================
    // FINANCE INVOICE
    // =====================================================

    function financeInvoice(
        uint256 invoiceId
    )
        public
        onlyManager
    {
        Invoice storage invoice = invoices[invoiceId];

        require(
            invoice.id != 0,
            "Invoice does not exist"
        );

        require(
            invoice.status == InvoiceStatus.Approved,
            "Invoice has not been approved"
        );

        // Uses normalized payer name so ABC, abc and AbC
        // are treated as the same payer
        bytes32 payerKey = getPayerKey(
            invoice.payerName
        );

        // Maximum exposure allowed for one payer
        uint256 maximumPayerExposure =
            (totalFundSize * MAX_PAYER_EXPOSURE_PERCENT) / 100;


        // CHECK 1: Invoice must not already be matured
        if (
            invoice.maturityDate <= block.timestamp
        ) {
            rejectInvoice(
                invoiceId,
                "Invoice already matured"
            );

            return;
        }


        // CHECK 2: Remaining maturity cannot exceed 90 days
        if (
            invoice.maturityDate >
            block.timestamp + (MAX_MATURITY_DAYS * 1 days)
        ) {
            rejectInvoice(
                invoiceId,
                "Maturity exceeds 90 days"
            );

            return;
        }


        // CHECK 3: Fund must have enough money available
        if (
            invoice.amount > availableFunds
        ) {
            rejectInvoice(
                invoiceId,
                "Insufficient available funds"
            );

            return;
        }


        // CHECK 4: Payer exposure cannot exceed 10%
        if (
            payerExposure[payerKey] + invoice.amount >
            maximumPayerExposure
        ) {
            rejectInvoice(
                invoiceId,
                "Payer exposure limit exceeded"
            );

            return;
        }


        // All checks passed
        invoice.status = InvoiceStatus.Financed;

        availableFunds -= invoice.amount;

        payerExposure[payerKey] += invoice.amount;

        emit InvoiceFinanced(
            invoiceId,
            invoice.amount
        );
    }


    // =====================================================
    // REJECT INVOICE
    // =====================================================

    function rejectInvoice(
        uint256 invoiceId,
        string memory reason
    )
        internal
    {
        Invoice storage invoice = invoices[invoiceId];

        invoice.status = InvoiceStatus.Rejected;

        invoice.rejectionReason = reason;

        emit InvoiceRejected(
            invoiceId,
            reason
        );
    }


    // =====================================================
    // RECORD REPAYMENT
    // =====================================================

    function recordRepayment(
        uint256 invoiceId
    )
        public
        onlyManager
    {
        Invoice storage invoice = invoices[invoiceId];

        require(
            invoice.id != 0,
            "Invoice does not exist"
        );

        require(
            invoice.status == InvoiceStatus.Financed,
            "Invoice is not financed"
        );

        // Uses the same normalized payer key
        bytes32 payerKey = getPayerKey(
            invoice.payerName
        );

        require(
            payerExposure[payerKey] >= invoice.amount,
            "Payer exposure is lower than repayment amount"
        );

        invoice.status = InvoiceStatus.Repaid;

        // Principal becomes available for financing again
        availableFunds += invoice.amount;

        // Reduce outstanding exposure to this payer
        payerExposure[payerKey] -= invoice.amount;

        emit InvoiceRepaid(
            invoiceId,
            invoice.amount
        );
    }


    // =====================================================
    // ERC-20 TRANSFER RESTRICTIONS
    // =====================================================

    /*
        Standard ERC-20 transfer() and transferFrom()
        are inherited from OpenZeppelin.

        Fund units can only move between
        approved investor wallets.
    */
    function _update(
        address from,
        address to,
        uint256 amount
    )
        internal
        override
    {
        // Normal investor-to-investor transfer
        if (
            from != address(0) &&
            to != address(0)
        ) {
            require(
                approvedInvestors[from],
                "Sender is not an approved investor"
            );

            require(
                approvedInvestors[to],
                "Receiver is not an approved investor"
            );
        }

        super._update(
            from,
            to,
            amount
        );
    }


    // =====================================================
    // ERC-20 DECIMALS
    // =====================================================

    // One integer = one RLU fund unit
    function decimals()
        public
        pure
        override
        returns (uint8)
    {
        return 0;
    }


    // =====================================================
    // PAYER NAME NORMALISATION
    // =====================================================

    /*
        Converts uppercase English letters to lowercase.

        ABC
        abc
        AbC

        will therefore all be treated as the same payer.
    */
    function normalizePayerName(
        string memory payerName
    )
        internal
        pure
        returns (string memory)
    {
        bytes memory nameBytes = bytes(payerName);

        for (
            uint256 i = 0;
            i < nameBytes.length;
            i++
        ) {
            uint8 character = uint8(nameBytes[i]);

            // ASCII A-Z = 65-90
            if (
                character >= 65 &&
                character <= 90
            ) {
                // Convert A-Z to a-z
                nameBytes[i] = bytes1(
                    character + 32
                );
            }
        }

        return string(nameBytes);
    }


    // =====================================================
    // CREATE CONSISTENT PAYER KEY
    // =====================================================

    function getPayerKey(
        string memory payerName
    )
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            bytes(
                normalizePayerName(
                    payerName
                )
            )
        );
    }


    // =====================================================
    // VIEW CURRENT PAYER EXPOSURE
    // =====================================================

    function getPayerExposure(
        string memory payerName
    )
        public
        view
        returns (uint256)
    {
        bytes32 payerKey = getPayerKey(
            payerName
        );

        return payerExposure[payerKey];
    }


    // =====================================================
    // VIEW MAXIMUM PAYER EXPOSURE
    // =====================================================

    function getMaxPayerExposure()
        public
        view
        returns (uint256)
    {
        return (
            totalFundSize *
            MAX_PAYER_EXPOSURE_PERCENT
        ) / 100;
    }

}