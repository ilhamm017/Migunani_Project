import { sequelize } from '../models';

type FkSpec = {
  name: string;
  table: string;
  column: string;
  refTable: string;
  refColumn: string;
  onDelete: 'RESTRICT' | 'SET NULL' | 'CASCADE';
  onUpdate: 'CASCADE' | 'RESTRICT';
  ensureIndexName?: string;
};

const q = async (sql: string, replacements?: any) => {
  return sequelize.query(sql, replacements ? { replacements } : undefined);
};

const tableExists = async (table: string) => {
  const [rows] = await q(
    `SELECT 1 AS ok
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table
     LIMIT 1`,
    { table }
  ) as any;
  return Array.isArray(rows) && rows.length > 0;
};

const getColumnMeta = async (table: string, column: string) => {
  const [rows] = await q(
    `SELECT COLUMN_TYPE AS columnType,
            CHARACTER_SET_NAME AS charsetName,
            COLLATION_NAME AS collationName,
            IS_NULLABLE AS isNullable
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table
       AND COLUMN_NAME = :column
     LIMIT 1`,
    { table, column }
  ) as any;
  const row = rows?.[0];
  return row
    ? {
      columnType: String(row.columnType || ''),
      charsetName: row.charsetName === null ? null : String(row.charsetName),
      collationName: row.collationName === null ? null : String(row.collationName),
      isNullable: String(row.isNullable || '').toUpperCase() === 'YES',
    }
    : null;
};

const ensureChildTypeMatchesParent = async (childTable: string, childColumn: string, parentTable: string, parentColumn: string) => {
  const parent = await getColumnMeta(parentTable, parentColumn);
  const child = await getColumnMeta(childTable, childColumn);
  if (!parent || !child) return;
  if (parent.columnType === child.columnType && parent.collationName === child.collationName && parent.charsetName === child.charsetName) return;

  const nullSql = child.isNullable ? 'NULL' : 'NOT NULL';
  const charsetSql = parent.charsetName ? `CHARACTER SET ${parent.charsetName}` : '';
  const collSql = parent.collationName ? `COLLATE ${parent.collationName}` : '';
  await q(`ALTER TABLE \`${childTable}\` MODIFY COLUMN \`${childColumn}\` ${parent.columnType} ${charsetSql} ${collSql} ${nullSql}`);
};

const fkExists = async (constraintName: string) => {
  const [rows] = await q(
    `SELECT 1 AS ok
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND CONSTRAINT_NAME = :name
       AND CONSTRAINT_TYPE = 'FOREIGN KEY'
     LIMIT 1`,
    { name: constraintName }
  ) as any;
  return Array.isArray(rows) && rows.length > 0;
};

const fkExistsOnColumn = async (table: string, column: string) => {
  const [rows] = await q(
    `SELECT 1 AS ok
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = :table
       AND COLUMN_NAME = :column
       AND REFERENCED_TABLE_NAME IS NOT NULL
     LIMIT 1`,
    { table, column }
  ) as any;
  return Array.isArray(rows) && rows.length > 0;
};

const indexExists = async (table: string, indexName: string) => {
  const [rows] = await q(
    `SELECT 1 AS ok
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table
       AND INDEX_NAME = :indexName
     LIMIT 1`,
    { table, indexName }
  ) as any;
  return Array.isArray(rows) && rows.length > 0;
};

const ensureIndex = async (table: string, indexName: string, columnsSql: string) => {
  if (await indexExists(table, indexName)) return;
  await q(`CREATE INDEX \`${indexName}\` ON \`${table}\` (${columnsSql})`);
};

const assertNoOrphans = async (sql: string, errMsg: string) => {
  const [rows] = await q(sql) as any;
  const count = Number(rows?.[0]?.orphanCount || 0);
  if (count > 0) throw new Error(`${errMsg} (orphanCount=${count})`);
};

const addFk = async (spec: FkSpec) => {
  if (await fkExists(spec.name)) return;
  if (await fkExistsOnColumn(spec.table, spec.column)) return;

  await ensureChildTypeMatchesParent(spec.table, spec.column, spec.refTable, spec.refColumn);
  if (spec.ensureIndexName) {
    await ensureIndex(spec.table, spec.ensureIndexName, `\`${spec.column}\``);
  }
  await q(
    `ALTER TABLE \`${spec.table}\`
     ADD CONSTRAINT \`${spec.name}\`
     FOREIGN KEY (\`${spec.column}\`)
     REFERENCES \`${spec.refTable}\` (\`${spec.refColumn}\`)
     ON DELETE ${spec.onDelete}
     ON UPDATE ${spec.onUpdate}`
  );
};

export const up = async (_ctx: { sequelize: typeof sequelize }) => {
  // Ops
  if (await tableExists('shifts') && await tableExists('users')) {
    await assertNoOrphans(
      `SELECT COUNT(*) AS orphanCount
       FROM shifts s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.user_id IS NOT NULL AND u.id IS NULL`,
      'Cannot add FK shifts.user_id -> users.id: orphan rows detected'
    );
    await addFk({
      name: 'fk_shifts_user',
      table: 'shifts',
      column: 'user_id',
      refTable: 'users',
      refColumn: 'id',
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      ensureIndexName: 'idx_shifts_user_id',
    });
  }

  // Inventory / stock
  if (await tableExists('stock_mutations') && await tableExists('products')) {
    await assertNoOrphans(
      `SELECT COUNT(*) AS orphanCount
       FROM stock_mutations sm
       LEFT JOIN products p ON p.id = sm.product_id
       WHERE sm.product_id IS NOT NULL AND p.id IS NULL`,
      'Cannot add FK stock_mutations.product_id -> products.id: orphan rows detected'
    );
    await addFk({
      name: 'fk_stock_mutations_product',
      table: 'stock_mutations',
      column: 'product_id',
      refTable: 'products',
      refColumn: 'id',
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      ensureIndexName: 'idx_stock_mutations_product_id',
    });
  }

  if (await tableExists('inventory_batches') && await tableExists('products')) {
    await assertNoOrphans(
      `SELECT COUNT(*) AS orphanCount
       FROM inventory_batches b
       LEFT JOIN products p ON p.id = b.product_id
       WHERE b.product_id IS NOT NULL AND p.id IS NULL`,
      'Cannot add FK inventory_batches.product_id -> products.id: orphan rows detected'
    );
    await addFk({
      name: 'fk_inventory_batches_product',
      table: 'inventory_batches',
      column: 'product_id',
      refTable: 'products',
      refColumn: 'id',
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      ensureIndexName: 'idx_inventory_batches_product_id',
    });
  }

  if (await tableExists('inventory_batch_reservations')) {
    if (await tableExists('orders')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM inventory_batch_reservations r
         LEFT JOIN orders o ON o.id = r.order_id
         WHERE r.order_id IS NOT NULL AND o.id IS NULL`,
        'Cannot add FK inventory_batch_reservations.order_id -> orders.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_inventory_batch_reservations_order',
        table: 'inventory_batch_reservations',
        column: 'order_id',
        refTable: 'orders',
        refColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_inventory_batch_reservations_order_id',
      });
    }
    if (await tableExists('order_items')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM inventory_batch_reservations r
         LEFT JOIN order_items oi ON oi.id = r.order_item_id
         WHERE r.order_item_id IS NOT NULL AND oi.id IS NULL`,
        'Cannot add FK inventory_batch_reservations.order_item_id -> order_items.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_inventory_batch_reservations_order_item',
        table: 'inventory_batch_reservations',
        column: 'order_item_id',
        refTable: 'order_items',
        refColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_inventory_batch_reservations_order_item_id',
      });
    }
    if (await tableExists('products')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM inventory_batch_reservations r
         LEFT JOIN products p ON p.id = r.product_id
         WHERE r.product_id IS NOT NULL AND p.id IS NULL`,
        'Cannot add FK inventory_batch_reservations.product_id -> products.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_inventory_batch_reservations_product',
        table: 'inventory_batch_reservations',
        column: 'product_id',
        refTable: 'products',
        refColumn: 'id',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_inventory_batch_reservations_product_id',
      });
    }
    if (await tableExists('inventory_batches')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM inventory_batch_reservations r
         LEFT JOIN inventory_batches b ON b.id = r.batch_id
         WHERE r.batch_id IS NOT NULL AND b.id IS NULL`,
        'Cannot add FK inventory_batch_reservations.batch_id -> inventory_batches.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_inventory_batch_reservations_batch',
        table: 'inventory_batch_reservations',
        column: 'batch_id',
        refTable: 'inventory_batches',
        refColumn: 'id',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_inventory_batch_reservations_batch_id',
      });
    }
  }

  if (await tableExists('inventory_batch_consumptions')) {
    if (await tableExists('inventory_batches')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM inventory_batch_consumptions c
         LEFT JOIN inventory_batches b ON b.id = c.batch_id
         WHERE c.batch_id IS NOT NULL AND b.id IS NULL`,
        'Cannot add FK inventory_batch_consumptions.batch_id -> inventory_batches.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_inventory_batch_consumptions_batch',
        table: 'inventory_batch_consumptions',
        column: 'batch_id',
        refTable: 'inventory_batches',
        refColumn: 'id',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_inventory_batch_consumptions_batch_id',
      });
    }
    if (await tableExists('products')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM inventory_batch_consumptions c
         LEFT JOIN products p ON p.id = c.product_id
         WHERE c.product_id IS NOT NULL AND p.id IS NULL`,
        'Cannot add FK inventory_batch_consumptions.product_id -> products.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_inventory_batch_consumptions_product',
        table: 'inventory_batch_consumptions',
        column: 'product_id',
        refTable: 'products',
        refColumn: 'id',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_inventory_batch_consumptions_product_id',
      });
    }
    if (await tableExists('order_items')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM inventory_batch_consumptions c
         LEFT JOIN order_items oi ON oi.id = c.order_item_id
         WHERE c.order_item_id IS NOT NULL AND oi.id IS NULL`,
        'Cannot add FK inventory_batch_consumptions.order_item_id -> order_items.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_inventory_batch_consumptions_order_item',
        table: 'inventory_batch_consumptions',
        column: 'order_item_id',
        refTable: 'order_items',
        refColumn: 'id',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_inventory_batch_consumptions_order_item_id',
      });
    }
  }

  // Purchasing
  if (await tableExists('purchase_orders')) {
    if (await tableExists('suppliers')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM purchase_orders po
         LEFT JOIN suppliers s ON s.id = po.supplier_id
         WHERE po.supplier_id IS NOT NULL AND s.id IS NULL`,
        'Cannot add FK purchase_orders.supplier_id -> suppliers.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_purchase_orders_supplier',
        table: 'purchase_orders',
        column: 'supplier_id',
        refTable: 'suppliers',
        refColumn: 'id',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_purchase_orders_supplier_id',
      });
    }
    if (await tableExists('users')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM purchase_orders po
         LEFT JOIN users u ON u.id = po.created_by
         WHERE po.created_by IS NOT NULL AND u.id IS NULL`,
        'Cannot add FK purchase_orders.created_by -> users.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_purchase_orders_created_by',
        table: 'purchase_orders',
        column: 'created_by',
        refTable: 'users',
        refColumn: 'id',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_purchase_orders_created_by',
      });

      // verified1_by / verified2_by are nullable
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM purchase_orders po
         LEFT JOIN users u ON u.id = po.verified1_by
         WHERE po.verified1_by IS NOT NULL AND u.id IS NULL`,
        'Cannot add FK purchase_orders.verified1_by -> users.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_purchase_orders_verified1_by',
        table: 'purchase_orders',
        column: 'verified1_by',
        refTable: 'users',
        refColumn: 'id',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_purchase_orders_verified1_by',
      });

      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM purchase_orders po
         LEFT JOIN users u ON u.id = po.verified2_by
         WHERE po.verified2_by IS NOT NULL AND u.id IS NULL`,
        'Cannot add FK purchase_orders.verified2_by -> users.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_purchase_orders_verified2_by',
        table: 'purchase_orders',
        column: 'verified2_by',
        refTable: 'users',
        refColumn: 'id',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_purchase_orders_verified2_by',
      });
    }
  }

  if (await tableExists('purchase_order_items')) {
    if (await tableExists('purchase_orders')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM purchase_order_items poi
         LEFT JOIN purchase_orders po ON po.id = poi.purchase_order_id
         WHERE poi.purchase_order_id IS NOT NULL AND po.id IS NULL`,
        'Cannot add FK purchase_order_items.purchase_order_id -> purchase_orders.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_purchase_order_items_purchase_order',
        table: 'purchase_order_items',
        column: 'purchase_order_id',
        refTable: 'purchase_orders',
        refColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_purchase_order_items_purchase_order_id',
      });
    }
    if (await tableExists('products')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM purchase_order_items poi
         LEFT JOIN products p ON p.id = poi.product_id
         WHERE poi.product_id IS NOT NULL AND p.id IS NULL`,
        'Cannot add FK purchase_order_items.product_id -> products.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_purchase_order_items_product',
        table: 'purchase_order_items',
        column: 'product_id',
        refTable: 'products',
        refColumn: 'id',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_purchase_order_items_product_id',
      });
    }
  }

  // Allocations
  if (await tableExists('order_allocations')) {
    if (await tableExists('orders')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM order_allocations oa
         LEFT JOIN orders o ON o.id = oa.order_id
         WHERE oa.order_id IS NOT NULL AND o.id IS NULL`,
        'Cannot add FK order_allocations.order_id -> orders.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_order_allocations_order',
        table: 'order_allocations',
        column: 'order_id',
        refTable: 'orders',
        refColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_order_allocations_order_id',
      });
    }
    if (await tableExists('products')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM order_allocations oa
         LEFT JOIN products p ON p.id = oa.product_id
         WHERE oa.product_id IS NOT NULL AND p.id IS NULL`,
        'Cannot add FK order_allocations.product_id -> products.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_order_allocations_product',
        table: 'order_allocations',
        column: 'product_id',
        refTable: 'products',
        refColumn: 'id',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_order_allocations_product_id',
      });
    }
  }

  // Delivery handover
  if (await tableExists('delivery_handovers')) {
    if (await tableExists('invoices')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM delivery_handovers h
         LEFT JOIN invoices i ON i.id = h.invoice_id
         WHERE h.invoice_id IS NOT NULL AND i.id IS NULL`,
        'Cannot add FK delivery_handovers.invoice_id -> invoices.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_delivery_handovers_invoice',
        table: 'delivery_handovers',
        column: 'invoice_id',
        refTable: 'invoices',
        refColumn: 'id',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_delivery_handovers_invoice_id',
      });
    }
    if (await tableExists('users')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM delivery_handovers h
         LEFT JOIN users u ON u.id = h.courier_id
         WHERE h.courier_id IS NOT NULL AND u.id IS NULL`,
        'Cannot add FK delivery_handovers.courier_id -> users.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_delivery_handovers_courier',
        table: 'delivery_handovers',
        column: 'courier_id',
        refTable: 'users',
        refColumn: 'id',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_delivery_handovers_courier_id',
      });

      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM delivery_handovers h
         LEFT JOIN users u ON u.id = h.checker_id
         WHERE h.checker_id IS NOT NULL AND u.id IS NULL`,
        'Cannot add FK delivery_handovers.checker_id -> users.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_delivery_handovers_checker',
        table: 'delivery_handovers',
        column: 'checker_id',
        refTable: 'users',
        refColumn: 'id',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_delivery_handovers_checker_id',
      });
    }
  }

  if (await tableExists('delivery_handover_items')) {
    if (await tableExists('delivery_handovers')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM delivery_handover_items hi
         LEFT JOIN delivery_handovers h ON h.id = hi.handover_id
         WHERE hi.handover_id IS NOT NULL AND h.id IS NULL`,
        'Cannot add FK delivery_handover_items.handover_id -> delivery_handovers.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_delivery_handover_items_handover',
        table: 'delivery_handover_items',
        column: 'handover_id',
        refTable: 'delivery_handovers',
        refColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_delivery_handover_items_handover_id',
      });
    }
    if (await tableExists('products')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM delivery_handover_items hi
         LEFT JOIN products p ON p.id = hi.product_id
         WHERE hi.product_id IS NOT NULL AND p.id IS NULL`,
        'Cannot add FK delivery_handover_items.product_id -> products.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_delivery_handover_items_product',
        table: 'delivery_handover_items',
        column: 'product_id',
        refTable: 'products',
        refColumn: 'id',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_delivery_handover_items_product_id',
      });
    }
  }

  // Chat
  if (await tableExists('chat_sessions') && await tableExists('users')) {
    await assertNoOrphans(
      `SELECT COUNT(*) AS orphanCount
       FROM chat_sessions s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.user_id IS NOT NULL AND u.id IS NULL`,
      'Cannot add FK chat_sessions.user_id -> users.id: orphan rows detected'
    );
    await addFk({
      name: 'fk_chat_sessions_user',
      table: 'chat_sessions',
      column: 'user_id',
      refTable: 'users',
      refColumn: 'id',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      ensureIndexName: 'idx_chat_sessions_user_id',
    });
  }

  if (await tableExists('chat_threads') && await tableExists('users')) {
    await assertNoOrphans(
      `SELECT COUNT(*) AS orphanCount
       FROM chat_threads t
       LEFT JOIN users u ON u.id = t.customer_user_id
       WHERE t.customer_user_id IS NOT NULL AND u.id IS NULL`,
      'Cannot add FK chat_threads.customer_user_id -> users.id: orphan rows detected'
    );
    await addFk({
      name: 'fk_chat_threads_customer_user',
      table: 'chat_threads',
      column: 'customer_user_id',
      refTable: 'users',
      refColumn: 'id',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      ensureIndexName: 'idx_chat_threads_customer_user_id',
    });
  }

  if (await tableExists('chat_thread_members')) {
    if (await tableExists('chat_threads')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM chat_thread_members m
         LEFT JOIN chat_threads t ON t.id = m.thread_id
         WHERE m.thread_id IS NOT NULL AND t.id IS NULL`,
        'Cannot add FK chat_thread_members.thread_id -> chat_threads.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_chat_thread_members_thread',
        table: 'chat_thread_members',
        column: 'thread_id',
        refTable: 'chat_threads',
        refColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_chat_thread_members_thread_id',
      });
    }
    if (await tableExists('users')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM chat_thread_members m
         LEFT JOIN users u ON u.id = m.user_id
         WHERE m.user_id IS NOT NULL AND u.id IS NULL`,
        'Cannot add FK chat_thread_members.user_id -> users.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_chat_thread_members_user',
        table: 'chat_thread_members',
        column: 'user_id',
        refTable: 'users',
        refColumn: 'id',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_chat_thread_members_user_id',
      });
    }
  }

  if (await tableExists('messages')) {
    if (await tableExists('chat_sessions')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM messages m
         LEFT JOIN chat_sessions s ON s.id = m.session_id
         WHERE m.session_id IS NOT NULL AND s.id IS NULL`,
        'Cannot add FK messages.session_id -> chat_sessions.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_messages_session',
        table: 'messages',
        column: 'session_id',
        refTable: 'chat_sessions',
        refColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_messages_session_id',
      });
    }
    if (await tableExists('chat_threads')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM messages m
         LEFT JOIN chat_threads t ON t.id = m.thread_id
         WHERE m.thread_id IS NOT NULL AND t.id IS NULL`,
        'Cannot add FK messages.thread_id -> chat_threads.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_messages_thread',
        table: 'messages',
        column: 'thread_id',
        refTable: 'chat_threads',
        refColumn: 'id',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_messages_thread_id',
      });
    }
    if (await tableExists('users')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM messages m
         LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.sender_id IS NOT NULL AND u.id IS NULL`,
        'Cannot add FK messages.sender_id -> users.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_messages_sender',
        table: 'messages',
        column: 'sender_id',
        refTable: 'users',
        refColumn: 'id',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_messages_sender_id',
      });
    }
    // Optional: quoted_message_id -> messages.id (self FK)
    if (await tableExists('messages')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM messages m
         LEFT JOIN messages q ON q.id = m.quoted_message_id
         WHERE m.quoted_message_id IS NOT NULL AND q.id IS NULL`,
        'Cannot add FK messages.quoted_message_id -> messages.id: orphan rows detected'
      );
      await addFk({
        name: 'fk_messages_quoted_message',
        table: 'messages',
        column: 'quoted_message_id',
        refTable: 'messages',
        refColumn: 'id',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        ensureIndexName: 'idx_messages_quoted_message_id',
      });
    }
  }
};

export const down = async (_ctx: { sequelize: typeof sequelize }) => {
  const names = [
    'fk_shifts_user',
    'fk_stock_mutations_product',
    'fk_inventory_batches_product',
    'fk_inventory_batch_reservations_order',
    'fk_inventory_batch_reservations_order_item',
    'fk_inventory_batch_reservations_product',
    'fk_inventory_batch_reservations_batch',
    'fk_inventory_batch_consumptions_batch',
    'fk_inventory_batch_consumptions_product',
    'fk_inventory_batch_consumptions_order_item',
    'fk_purchase_orders_supplier',
    'fk_purchase_orders_created_by',
    'fk_purchase_orders_verified1_by',
    'fk_purchase_orders_verified2_by',
    'fk_purchase_order_items_purchase_order',
    'fk_purchase_order_items_product',
    'fk_order_allocations_order',
    'fk_order_allocations_product',
    'fk_delivery_handovers_invoice',
    'fk_delivery_handovers_courier',
    'fk_delivery_handovers_checker',
    'fk_delivery_handover_items_handover',
    'fk_delivery_handover_items_product',
    'fk_chat_sessions_user',
    'fk_chat_threads_customer_user',
    'fk_chat_thread_members_thread',
    'fk_chat_thread_members_user',
    'fk_messages_session',
    'fk_messages_thread',
    'fk_messages_sender',
    'fk_messages_quoted_message',
  ];

  for (const name of names) {
    const [ownerRows] = await q(
      `SELECT TABLE_NAME AS tableName
       FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE()
         AND CONSTRAINT_NAME = :name
         AND CONSTRAINT_TYPE = 'FOREIGN KEY'
       LIMIT 1`,
      { name }
    ) as any;
    const tableName = ownerRows?.[0]?.tableName ? String(ownerRows[0].tableName) : '';
    if (!tableName) continue;
    await q(`ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${name}\``);
  }
};
