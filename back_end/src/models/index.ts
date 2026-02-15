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
import OrderIssue from './OrderIssue';
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

// Transactions
User.hasMany(Order, { foreignKey: 'customer_id', as: 'CustomerOrders' });
Order.belongsTo(User, { foreignKey: 'customer_id', as: 'Customer' });

User.hasMany(Order, { foreignKey: 'courier_id', as: 'CourierDeliveries' });
Order.belongsTo(User, { foreignKey: 'courier_id', as: 'Courier' });

Order.hasMany(OrderItem, { foreignKey: 'order_id', onDelete: 'CASCADE' });
OrderItem.belongsTo(Order, { foreignKey: 'order_id' });

Product.hasMany(OrderItem, { foreignKey: 'product_id' });
OrderItem.belongsTo(Product, { foreignKey: 'product_id' });

Order.hasMany(OrderAllocation, { foreignKey: 'order_id', as: 'Allocations' });
OrderAllocation.belongsTo(Order, { foreignKey: 'order_id' });

OrderAllocation.belongsTo(Product, { foreignKey: 'product_id', as: 'Product' });
Product.hasMany(OrderAllocation, { foreignKey: 'product_id' });

Order.hasOne(Invoice, { foreignKey: 'order_id' });
Invoice.belongsTo(Order, { foreignKey: 'order_id' });

Order.hasMany(OrderIssue, { foreignKey: 'order_id', as: 'Issues' });
OrderIssue.belongsTo(Order, { foreignKey: 'order_id' });

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
User.hasMany(Expense, { foreignKey: 'created_by' });
Expense.belongsTo(User, { foreignKey: 'created_by' });

User.hasMany(PurchaseOrder, { foreignKey: 'created_by' });
PurchaseOrder.belongsTo(User, { foreignKey: 'created_by' });

PurchaseOrder.hasMany(PurchaseOrderItem, { foreignKey: 'purchase_order_id', as: 'Items' });
PurchaseOrderItem.belongsTo(PurchaseOrder, { foreignKey: 'purchase_order_id' });

PurchaseOrderItem.belongsTo(Product, { foreignKey: 'product_id' });
Product.hasMany(PurchaseOrderItem, { foreignKey: 'product_id' });

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
    OrderIssue,
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
    Retur
};
