import sequelize from '../config/database';
import User from './User';
import CustomerProfile from './CustomerProfile';
import Product from './Product';
import Category from './Category';
import ProductCategory from './ProductCategory';
import Supplier from './Supplier';
import StockMutation from './StockMutation';
import PurchaseOrder from './PurchaseOrder';
import PurchaseOrderItem from './PurchaseOrderItem';
import Order from './Order';
import OrderItem from './OrderItem';
import Invoice from './Invoice';
import InvoiceItem from './InvoiceItem';
import InvoiceCostOverride from './InvoiceCostOverride';
import OrderIssue from './OrderIssue';
import OrderEvent from './OrderEvent';
import ChatSession from './ChatSession';
import Message from './Message';
import ChatThread from './ChatThread';
import ChatThreadMember from './ChatThreadMember';
import Expense from './Expense';
import ExpenseLabel from './ExpenseLabel';
import Cart from './Cart';
import CartItem from './CartItem';
import Shift from './Shift';
import Setting from './Setting';
import StockOpname from './StockOpname';
import StockOpnameItem from './StockOpnameItem';
import OrderAllocation from './OrderAllocation';
import Retur from './Retur';
import DriverDebtAdjustment from './DriverDebtAdjustment';
import DriverBalanceAdjustment from './DriverBalanceAdjustment';
import ReturHandover from './ReturHandover';
import ReturHandoverItem from './ReturHandoverItem';
import DeliveryHandover from './DeliveryHandover';
import DeliveryHandoverItem from './DeliveryHandoverItem';
import Account from './Account';
import Journal from './Journal';
import JournalLine from './JournalLine';
import CodCollection from './CodCollection';
import CodSettlement from './CodSettlement';
import SupplierInvoice from './SupplierInvoice';
import SupplierPayment from './SupplierPayment';
import Backorder from './Backorder';
import AccountingPeriod from './AccountingPeriod';
import ProductCostState from './ProductCostState';
import InventoryCostLedger from './InventoryCostLedger';
import CreditNote from './CreditNote';
import CreditNoteLine from './CreditNoteLine';
import IdempotencyKey from './IdempotencyKey';
import NotificationOutbox from './NotificationOutbox';
import AuditLog from './AuditLog';
import SupplierPreorder from './SupplierPreorder';
import SupplierPreorderItem from './SupplierPreorderItem';

// Stock Opname
StockOpname.hasMany(StockOpnameItem, { foreignKey: 'opname_id', as: 'Items' });
StockOpnameItem.belongsTo(StockOpname, { foreignKey: 'opname_id' });

StockOpnameItem.belongsTo(Product, { foreignKey: 'product_id', as: 'Product' });
Product.hasMany(StockOpnameItem, { foreignKey: 'product_id' });

StockOpname.belongsTo(User, { foreignKey: 'admin_id', as: 'Creator' });
User.hasMany(StockOpname, { foreignKey: 'admin_id' });

// Retur
Retur.belongsTo(Order, { foreignKey: 'order_id' });
Order.hasMany(Retur, { foreignKey: 'order_id' });

Retur.belongsTo(Product, { foreignKey: 'product_id' });
Product.hasMany(Retur, { foreignKey: 'product_id' });

Retur.belongsTo(User, { foreignKey: 'created_by', as: 'Creator' });
User.hasMany(Retur, { foreignKey: 'created_by' });

Retur.belongsTo(User, { foreignKey: 'courier_id', as: 'Courier' });
User.hasMany(Retur, { foreignKey: 'courier_id', as: 'CourierReturs' });

// Driver Debt Adjustments
DriverDebtAdjustment.belongsTo(User, { foreignKey: 'driver_id', as: 'Driver' });
User.hasMany(DriverDebtAdjustment, { foreignKey: 'driver_id', as: 'DriverDebtAdjustments' });
DriverDebtAdjustment.belongsTo(User, { foreignKey: 'created_by', as: 'Creator' });
User.hasMany(DriverDebtAdjustment, { foreignKey: 'created_by', as: 'CreatedDriverDebtAdjustments' });
DriverDebtAdjustment.belongsTo(Invoice, { foreignKey: 'invoice_id', as: 'Invoice' });
Invoice.hasMany(DriverDebtAdjustment, { foreignKey: 'invoice_id', as: 'DriverDebtAdjustments' });
DriverDebtAdjustment.belongsTo(Retur, { foreignKey: 'retur_id', as: 'Retur' });
Retur.hasOne(DriverDebtAdjustment, { foreignKey: 'retur_id', as: 'DriverDebtAdjustment' });

// Driver Balance Adjustments (COD shortage/surplus)
DriverBalanceAdjustment.belongsTo(User, { foreignKey: 'driver_id', as: 'Driver' });
User.hasMany(DriverBalanceAdjustment, { foreignKey: 'driver_id', as: 'DriverBalanceAdjustments' });
DriverBalanceAdjustment.belongsTo(User, { foreignKey: 'created_by', as: 'Creator' });
User.hasMany(DriverBalanceAdjustment, { foreignKey: 'created_by', as: 'CreatedDriverBalanceAdjustments' });

// Retur Handovers
ReturHandover.belongsTo(Invoice, { foreignKey: 'invoice_id', as: 'Invoice' });
Invoice.hasMany(ReturHandover, { foreignKey: 'invoice_id', as: 'ReturHandovers' });
ReturHandover.belongsTo(User, { foreignKey: 'driver_id', as: 'Driver' });
User.hasMany(ReturHandover, { foreignKey: 'driver_id', as: 'ReturHandovers' });
ReturHandover.belongsTo(User, { foreignKey: 'received_by', as: 'Receiver' });
User.hasMany(ReturHandover, { foreignKey: 'received_by', as: 'ReceivedReturHandovers' });

ReturHandover.hasMany(ReturHandoverItem, { foreignKey: 'handover_id', as: 'Items' });
ReturHandoverItem.belongsTo(ReturHandover, { foreignKey: 'handover_id', as: 'Handover' });
ReturHandoverItem.belongsTo(Retur, { foreignKey: 'retur_id', as: 'Retur' });
Retur.hasOne(ReturHandoverItem, { foreignKey: 'retur_id', as: 'HandoverItem' });

// Delivery Handovers (Outbound)
DeliveryHandover.belongsTo(Invoice, { foreignKey: 'invoice_id', as: 'Invoice' });
Invoice.hasMany(DeliveryHandover, { foreignKey: 'invoice_id', as: 'DeliveryHandovers' });
DeliveryHandover.belongsTo(User, { foreignKey: 'courier_id', as: 'Driver' });
User.hasMany(DeliveryHandover, { foreignKey: 'courier_id', as: 'DeliveryHandoversAsDriver' });
DeliveryHandover.belongsTo(User, { foreignKey: 'checker_id', as: 'Checker' });
User.hasMany(DeliveryHandover, { foreignKey: 'checker_id', as: 'DeliveryHandoversAsChecker' });

DeliveryHandover.hasMany(DeliveryHandoverItem, { foreignKey: 'handover_id', as: 'Items' });
DeliveryHandoverItem.belongsTo(DeliveryHandover, { foreignKey: 'handover_id', as: 'Handover' });
DeliveryHandoverItem.belongsTo(Product, { foreignKey: 'product_id', as: 'Product' });
Product.hasMany(DeliveryHandoverItem, { foreignKey: 'product_id', as: 'DeliveryHandoverItems' });

// User & Auth
User.hasOne(CustomerProfile, { foreignKey: 'user_id' });
CustomerProfile.belongsTo(User, { foreignKey: 'user_id' });

// Shifts
User.hasMany(Shift, { foreignKey: 'user_id' });
Shift.belongsTo(User, { foreignKey: 'user_id' });

// Cart
User.hasOne(Cart, { foreignKey: 'user_id' });
Cart.belongsTo(User, { foreignKey: 'user_id' });

Cart.hasMany(CartItem, { foreignKey: 'cart_id' });
CartItem.belongsTo(Cart, { foreignKey: 'cart_id' });

CartItem.belongsTo(Product, { foreignKey: 'product_id' });
Product.hasMany(CartItem, { foreignKey: 'product_id' });

// Inventory
Category.hasMany(Product, { foreignKey: 'category_id' });
Product.belongsTo(Category, { foreignKey: 'category_id' });
Product.hasMany(ProductCategory, { foreignKey: 'product_id' });
ProductCategory.belongsTo(Product, { foreignKey: 'product_id' });
Category.hasMany(ProductCategory, { foreignKey: 'category_id' });
ProductCategory.belongsTo(Category, { foreignKey: 'category_id' });
Product.belongsToMany(Category, {
    through: ProductCategory,
    foreignKey: 'product_id',
    otherKey: 'category_id',
    as: 'Categories'
});
Category.belongsToMany(Product, {
    through: ProductCategory,
    foreignKey: 'category_id',
    otherKey: 'product_id',
    as: 'TaggedProducts'
});

Supplier.hasMany(PurchaseOrder, { foreignKey: 'supplier_id' });
PurchaseOrder.belongsTo(Supplier, { foreignKey: 'supplier_id' });

Product.hasMany(StockMutation, { foreignKey: 'product_id' });
StockMutation.belongsTo(Product, { foreignKey: 'product_id' });
Product.hasOne(ProductCostState, { foreignKey: 'product_id', as: 'CostState' });
ProductCostState.belongsTo(Product, { foreignKey: 'product_id' });
Product.hasMany(InventoryCostLedger, { foreignKey: 'product_id', as: 'CostLedgers' });
InventoryCostLedger.belongsTo(Product, { foreignKey: 'product_id' });

// Transactions
User.hasMany(Order, { foreignKey: 'customer_id', as: 'CustomerOrders' });
Order.belongsTo(User, { foreignKey: 'customer_id', as: 'Customer' });

User.hasMany(Order, { foreignKey: 'courier_id', as: 'CourierDeliveries' });
Order.belongsTo(User, { foreignKey: 'courier_id', as: 'Courier' });

Order.hasMany(OrderItem, { foreignKey: 'order_id', onDelete: 'CASCADE' });
OrderItem.belongsTo(Order, { foreignKey: 'order_id' });

Order.hasMany(Order, { foreignKey: 'parent_order_id', as: 'Children' });
Order.belongsTo(Order, { foreignKey: 'parent_order_id', as: 'Parent' });

Product.hasMany(OrderItem, { foreignKey: 'product_id' });
OrderItem.belongsTo(Product, { foreignKey: 'product_id' });

Order.hasMany(OrderAllocation, { foreignKey: 'order_id', as: 'Allocations' });
OrderAllocation.belongsTo(Order, { foreignKey: 'order_id' });

OrderAllocation.belongsTo(Product, { foreignKey: 'product_id', as: 'Product' });
Product.hasMany(OrderAllocation, { foreignKey: 'product_id' });

Order.hasOne(Invoice, { foreignKey: 'order_id' });
Invoice.belongsTo(Order, { foreignKey: 'order_id' });
Invoice.hasMany(InvoiceCostOverride, { foreignKey: 'invoice_id', as: 'CostOverrides' });
InvoiceCostOverride.belongsTo(Invoice, { foreignKey: 'invoice_id' });
InvoiceCostOverride.belongsTo(Product, { foreignKey: 'product_id', as: 'Product' });
Product.hasMany(InvoiceCostOverride, { foreignKey: 'product_id', as: 'InvoiceCostOverrides' });
Invoice.hasMany(CreditNote, { foreignKey: 'invoice_id', as: 'CreditNotes' });
CreditNote.belongsTo(Invoice, { foreignKey: 'invoice_id' });
CreditNote.hasMany(CreditNoteLine, { foreignKey: 'credit_note_id', as: 'Lines' });
CreditNoteLine.belongsTo(CreditNote, { foreignKey: 'credit_note_id' });

Invoice.hasMany(InvoiceItem, { foreignKey: 'invoice_id', as: 'Items' });
InvoiceItem.belongsTo(Invoice, { foreignKey: 'invoice_id' });
OrderItem.hasMany(InvoiceItem, { foreignKey: 'order_item_id', as: 'InvoiceItems' });
InvoiceItem.belongsTo(OrderItem, { foreignKey: 'order_item_id' });
CreditNoteLine.belongsTo(Product, { foreignKey: 'product_id', as: 'Product' });

Order.hasMany(OrderIssue, { foreignKey: 'order_id', as: 'Issues' });
OrderIssue.belongsTo(Order, { foreignKey: 'order_id' });
Order.hasMany(OrderEvent, { foreignKey: 'order_id', as: 'Events' });
OrderEvent.belongsTo(Order, { foreignKey: 'order_id' });
OrderItem.hasMany(OrderEvent, { foreignKey: 'order_item_id', as: 'Events' });
OrderEvent.belongsTo(OrderItem, { foreignKey: 'order_item_id' });
Invoice.hasMany(OrderEvent, { foreignKey: 'invoice_id', as: 'Events' });
OrderEvent.belongsTo(Invoice, { foreignKey: 'invoice_id' });
User.hasMany(OrderEvent, { foreignKey: 'actor_user_id', as: 'ActorOrderEvents' });
OrderEvent.belongsTo(User, { foreignKey: 'actor_user_id', as: 'Actor' });

User.hasMany(Invoice, { foreignKey: 'verified_by', as: 'VerifiedInvoices' });
Invoice.belongsTo(User, { foreignKey: 'verified_by', as: 'Verifier' });

User.hasMany(OrderIssue, { foreignKey: 'created_by', as: 'CreatedOrderIssues' });
OrderIssue.belongsTo(User, { foreignKey: 'created_by', as: 'IssueCreator' });

User.hasMany(OrderIssue, { foreignKey: 'resolved_by', as: 'ResolvedOrderIssues' });
OrderIssue.belongsTo(User, { foreignKey: 'resolved_by', as: 'IssueResolver' });

// Chat
User.hasMany(ChatSession, { foreignKey: 'user_id' });
ChatSession.belongsTo(User, { foreignKey: 'user_id' });

ChatSession.hasMany(Message, { foreignKey: 'session_id' });
Message.belongsTo(ChatSession, { foreignKey: 'session_id' });

User.hasMany(Message, { foreignKey: 'sender_id' });
Message.belongsTo(User, { foreignKey: 'sender_id' });

ChatThread.hasMany(ChatThreadMember, { foreignKey: 'thread_id', as: 'Members' });
ChatThreadMember.belongsTo(ChatThread, { foreignKey: 'thread_id' });

User.hasMany(ChatThreadMember, { foreignKey: 'user_id', as: 'ThreadMemberships' });
ChatThreadMember.belongsTo(User, { foreignKey: 'user_id' });

ChatThread.hasMany(Message, { foreignKey: 'thread_id', as: 'ThreadMessages' });
Message.belongsTo(ChatThread, { foreignKey: 'thread_id' });

User.hasMany(ChatThread, { foreignKey: 'customer_user_id', as: 'CustomerOmniThreads' });
ChatThread.belongsTo(User, { foreignKey: 'customer_user_id', as: 'CustomerUser' });

// Finance
AccountingPeriod.belongsTo(User, { foreignKey: 'closed_by', as: 'ClosedBy' });

User.hasMany(Expense, { foreignKey: 'created_by' });
Expense.belongsTo(User, { foreignKey: 'created_by' });

Expense.belongsTo(User, { as: 'Approver', foreignKey: 'approved_by' });
User.hasMany(Expense, { foreignKey: 'approved_by', as: 'ApprovedExpenses' });

Expense.belongsTo(Account, { foreignKey: 'account_id', as: 'SourceAccount' });
// Account.hasMany(Expense, { foreignKey: 'account_id' }); // Optional

User.hasMany(PurchaseOrder, { foreignKey: 'created_by' });
PurchaseOrder.belongsTo(User, { foreignKey: 'created_by' });

PurchaseOrder.hasMany(PurchaseOrderItem, { foreignKey: 'purchase_order_id', as: 'Items' });
PurchaseOrderItem.belongsTo(PurchaseOrder, { foreignKey: 'purchase_order_id' });

// Procurement (Supplier Preorders)
Supplier.hasMany(SupplierPreorder, { foreignKey: 'supplier_id', as: 'Preorders' });
SupplierPreorder.belongsTo(Supplier, { foreignKey: 'supplier_id', as: 'Supplier' });

User.hasMany(SupplierPreorder, { foreignKey: 'created_by', as: 'CreatedSupplierPreorders' });
SupplierPreorder.belongsTo(User, { foreignKey: 'created_by', as: 'Creator' });

SupplierPreorder.hasMany(SupplierPreorderItem, { foreignKey: 'supplier_preorder_id', as: 'Items' });
SupplierPreorderItem.belongsTo(SupplierPreorder, { foreignKey: 'supplier_preorder_id', as: 'Preorder' });

SupplierPreorderItem.belongsTo(Product, { foreignKey: 'product_id', as: 'Product' });
Product.hasMany(SupplierPreorderItem, { foreignKey: 'product_id', as: 'SupplierPreorderItems' });

// Supplier Invoices & Payments (AP)
Supplier.hasMany(SupplierInvoice, { foreignKey: 'supplier_id', as: 'SupplierInvoices' });
SupplierInvoice.belongsTo(Supplier, { foreignKey: 'supplier_id', as: 'Supplier' });

PurchaseOrder.hasOne(SupplierInvoice, { foreignKey: 'purchase_order_id', as: 'SupplierInvoice' });
SupplierInvoice.belongsTo(PurchaseOrder, { foreignKey: 'purchase_order_id', as: 'PurchaseOrder' });

SupplierInvoice.hasMany(SupplierPayment, { foreignKey: 'supplier_invoice_id', as: 'Payments' });
SupplierPayment.belongsTo(SupplierInvoice, { foreignKey: 'supplier_invoice_id', as: 'Invoice' });

SupplierPayment.belongsTo(Account, { foreignKey: 'account_id', as: 'Account' });

User.hasMany(SupplierInvoice, { foreignKey: 'created_by', as: 'CreatedSupplierInvoices' });
SupplierInvoice.belongsTo(User, { foreignKey: 'created_by', as: 'Creator' });

User.hasMany(SupplierPayment, { foreignKey: 'created_by', as: 'CreatedSupplierPayments' });
SupplierPayment.belongsTo(User, { foreignKey: 'created_by', as: 'Creator' });

// Accounts
Account.belongsTo(Account, { foreignKey: 'parent_id', as: 'Parent' });
Account.hasMany(Account, { foreignKey: 'parent_id', as: 'Children' });

// Journals
Journal.hasMany(JournalLine, { foreignKey: 'journal_id', as: 'Lines' });
JournalLine.belongsTo(Journal, { foreignKey: 'journal_id' });

JournalLine.belongsTo(Account, { foreignKey: 'account_id', as: 'Account' });
Account.hasMany(JournalLine, { foreignKey: 'account_id' });

Journal.belongsTo(User, { foreignKey: 'created_by', as: 'Creator' });
User.hasMany(Journal, { foreignKey: 'created_by' });

AuditLog.belongsTo(User, { foreignKey: 'actor_user_id', as: 'Actor' });
User.hasMany(AuditLog, { foreignKey: 'actor_user_id', as: 'AuditLogs' });

// COD System
CodCollection.belongsTo(Invoice, { foreignKey: 'invoice_id' });
Invoice.hasOne(CodCollection, { foreignKey: 'invoice_id' });

CodCollection.belongsTo(User, { foreignKey: 'driver_id', as: 'Driver' });
User.hasMany(CodCollection, { foreignKey: 'driver_id', as: 'Collections' });

CodSettlement.hasMany(CodCollection, { foreignKey: 'settlement_id', as: 'Collections' });
CodCollection.belongsTo(CodSettlement, { foreignKey: 'settlement_id' });

CodSettlement.belongsTo(User, { foreignKey: 'driver_id', as: 'Driver' });
CodSettlement.belongsTo(User, { foreignKey: 'received_by', as: 'Receiver' });

PurchaseOrderItem.belongsTo(Product, { foreignKey: 'product_id' });
Product.hasMany(PurchaseOrderItem, { foreignKey: 'product_id' });

// Backorders
Backorder.belongsTo(OrderItem, { foreignKey: 'order_item_id' });
OrderItem.hasOne(Backorder, { foreignKey: 'order_item_id' });

export {
    sequelize,
    User,
    CustomerProfile,
    Product,
    Category,
    ProductCategory,
    Supplier,
    StockMutation,
    PurchaseOrder,
    PurchaseOrderItem,
    Order,
    OrderItem,
    Invoice,
    InvoiceItem,
    InvoiceCostOverride,
    OrderIssue,
    OrderEvent,
    ChatSession,
    ChatThread,
    ChatThreadMember,
    Message,
    Expense,
    ExpenseLabel,
    Cart,
    CartItem,
    Shift,
    Setting,
    StockOpname,
    StockOpnameItem,
    OrderAllocation,
    Retur,
    DriverDebtAdjustment,
    DriverBalanceAdjustment,
    ReturHandover,
    ReturHandoverItem,
    DeliveryHandover,
    DeliveryHandoverItem,
    Account,
    Journal,
    JournalLine,
    CodCollection,
    CodSettlement,
    SupplierInvoice,
    SupplierPayment,
    Backorder,
    AccountingPeriod,
    ProductCostState,
    InventoryCostLedger,
    CreditNote,
    CreditNoteLine,
    IdempotencyKey,
    NotificationOutbox,
    AuditLog,
    SupplierPreorder,
    SupplierPreorderItem
};
