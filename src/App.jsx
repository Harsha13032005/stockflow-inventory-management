import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import "./App.css";

const emptyProduct = {
  name: "",
  sku: "",
  description: "",
  quantity: "0",
  cost_price: "",
  selling_price: "",
  low_stock_threshold: "",
};

function App() {
  const [session, setSession] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);

  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");

  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [form, setForm] = useState(emptyProduct);
  const [defaultThreshold, setDefaultThreshold] = useState("5");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Restore the logged-in session and listen for login/logout changes.
  useEffect(() => {
    let active = true;

    async function restoreSession() {
      const { data, error } = await supabase.auth.getSession();

      if (!active) return;

      if (error) setError(error.message);

      setSession(data?.session ?? null);
      setLoading(false);
    }

    restoreSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (active) {
        setSession(newSession);
        setError("");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // Find or create the organization, then load its products.
  useEffect(() => {
    if (!session?.user) {
      setOrganization(null);
      setProducts([]);
      setPageLoading(false);
      return;
    }

    let active = true;

    async function loadDashboard() {
      setPageLoading(true);
      setError("");

      try {
        const user = session.user;

        let { data: org, error: orgError } = await supabase
          .from("organizations")
          .select("*")
          .eq("owner_id", user.id)
          .maybeSingle();

        if (orgError) throw orgError;

        // Create the organization if it wasn't created during signup.
        if (!org) {
          const name =
            user.user_metadata?.organization_name ||
            user.email?.split("@")[0] ||
            "My Organization";

          const { data: newOrg, error: createError } = await supabase
            .from("organizations")
            .insert({
              name,
              owner_id: user.id,
            })
            .select()
            .single();

          if (createError) throw createError;
          org = newOrg;
        }

        if (!active) return;

        setOrganization(org);
        setDefaultThreshold(String(org.default_low_stock_threshold ?? 5));

        const { data: productRows, error: productError } = await supabase
          .from("products")
          .select("*")
          .eq("organization_id", org.id)
          .order("created_at", { ascending: false });

        if (productError) throw productError;

        if (active) setProducts(productRows || []);
      } catch (err) {
        if (active) {
          setError(err.message || "Unable to load your inventory.");
        }
      } finally {
        if (active) setPageLoading(false);
      }
    }

    loadDashboard();

    return () => {
      active = false;
    };
  }, [session]);

  async function handleAuth(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      if (isSignup) {
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              organization_name: organizationName.trim(),
            },
          },
        });

        if (authError) throw authError;

        if (data.session) {
          setSession(data.session);
          setNotice("Account created successfully.");
        } else {
          setNotice(
            "Account created. Confirm your email, then log in using your credentials."
          );
          setIsSignup(false);
        }
      } else {
        const { data, error: authError } =
          await supabase.auth.signInWithPassword({
            email,
            password,
          });

        if (authError) throw authError;

        setSession(data.session);
        setNotice("Login successful.");
      }
    } catch (err) {
      setError(err.message || "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setError("");

    const { error: logoutError } = await supabase.auth.signOut();

    if (logoutError) {
      setError(logoutError.message);
      return;
    }

    setSession(null);
    setOrganization(null);
    setProducts([]);
    setNotice("");
  }

  function openAddForm() {
    setEditingProduct(null);
    setForm({ ...emptyProduct });
    setShowForm(true);
    setError("");
    setNotice("");
  }

  function openEditForm(product) {
    setEditingProduct(product);
    setForm({
      name: product.name || "",
      sku: product.sku || "",
      description: product.description || "",
      quantity: String(product.quantity ?? 0),
      cost_price: product.cost_price ?? "",
      selling_price: product.selling_price ?? "",
      low_stock_threshold:
        product.low_stock_threshold == null
          ? ""
          : String(product.low_stock_threshold),
    });
    setShowForm(true);
    setError("");
    setNotice("");
  }

  function updateForm(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  async function saveProduct(event) {
    event.preventDefault();

    if (!organization) {
      setError("Your organization is not loaded. Refresh and try again.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const quantity = Number(form.quantity);

      if (
        !form.name.trim() ||
        !form.sku.trim() ||
        !Number.isInteger(quantity) ||
        quantity < 0
      ) {
        throw new Error(
          "Enter a product name, SKU, and a valid non-negative whole quantity."
        );
      }

      const optionalNumber = (value) =>
        value === "" ? null : Number(value);

      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim(),
        description: form.description.trim() || null,
        quantity,
        cost_price: optionalNumber(form.cost_price),
        selling_price: optionalNumber(form.selling_price),
        low_stock_threshold: optionalNumber(form.low_stock_threshold),
        organization_id: organization.id,
        updated_at: new Date().toISOString(),
      };

      for (const field of ["cost_price", "selling_price"]) {
        if (
          payload[field] !== null &&
          (!Number.isFinite(payload[field]) || payload[field] < 0)
        ) {
          throw new Error("Prices must be valid non-negative numbers.");
        }
      }

      if (
        payload.low_stock_threshold !== null &&
        (!Number.isInteger(payload.low_stock_threshold) ||
          payload.low_stock_threshold < 0)
      ) {
        throw new Error("The low-stock threshold must be a whole number.");
      }

      if (editingProduct) {
        const { error: updateError } = await supabase
          .from("products")
          .update(payload)
          .eq("id", editingProduct.id)
          .eq("organization_id", organization.id);

        if (updateError) throw updateError;

        setNotice("Product updated successfully.");
      } else {
        const { error: insertError } = await supabase
          .from("products")
          .insert(payload);

        if (insertError) throw insertError;

        setNotice("Product added successfully.");
      }

      setShowForm(false);
      setEditingProduct(null);
      setForm({ ...emptyProduct });

      await refreshProducts();
    } catch (err) {
      setError(err.message || "Could not save the product.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshProducts() {
    if (!organization) return;

    const { data, error: productError } = await supabase
      .from("products")
      .select("*")
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: false });

    if (productError) {
      setError(productError.message);
      return;
    }

    setProducts(data || []);
  }

  async function deleteProduct(product) {
    const confirmed = window.confirm(
      `Delete "${product.name}" permanently?`
    );

    if (!confirmed) return;

    setError("");
    setNotice("");

    const { error: deleteError } = await supabase
      .from("products")
      .delete()
      .eq("id", product.id)
      .eq("organization_id", organization.id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setProducts((previous) =>
      previous.filter((item) => item.id !== product.id)
    );
    setNotice("Product deleted successfully.");
  }

  async function saveDefaultThreshold(event) {
    event.preventDefault();

    const value = Number(defaultThreshold);

    if (!Number.isInteger(value) || value < 0) {
      setError("Default threshold must be a non-negative whole number.");
      return;
    }

    setError("");
    setNotice("");

    const { data, error: updateError } = await supabase
      .from("organizations")
      .update({ default_low_stock_threshold: value })
      .eq("id", organization.id)
      .select()
      .single();

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setOrganization(data);
    setNotice("Default low-stock threshold saved.");
  }

  const filteredProducts = useMemo(() => {
    const searchText = search.toLowerCase().trim();

    return products.filter((product) => {
      return (
        product.name.toLowerCase().includes(searchText) ||
        product.sku.toLowerCase().includes(searchText)
      );
    });
  }, [products, search]);

  const totalQuantity = products.reduce(
    (total, product) => total + Number(product.quantity || 0),
    0
  );

  const lowStockProducts = products.filter((product) => {
    const threshold =
      product.low_stock_threshold ??
      organization?.default_low_stock_threshold ??
      5;

    return Number(product.quantity) <= Number(threshold);
  });

  if (loading) {
    return <div className="loading-screen">Loading StockFlow...</div>;
  }

  // Login and signup page.
  if (!session) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1 className="brand auth-brand">StockFlow</h1>
          <p className="muted">Inventory management made simple.</p>

          <h2>{isSignup ? "Create your account" : "Welcome back"}</h2>
          <p className="muted">
            {isSignup
              ? "Set up your organization to get started."
              : "Log in to manage your inventory."}
          </p>

          {error && <div className="alert error-alert">{error}</div>}
          {notice && <div className="alert success-alert">{notice}</div>}

          <form onSubmit={handleAuth} className="stack-form">
            {isSignup && (
              <label>
                Organization name
                <input
                  type="text"
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  placeholder="My Company"
                  required
                />
              </label>
            )}

            <label>
              Email address
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                placeholder="Enter your password"
                required
              />
            </label>

            <button className="primary-button full-button" disabled={busy}>
              {busy
                ? "Please wait..."
                : isSignup
                  ? "Create Account"
                  : "Log In"}
            </button>
          </form>

          <p className="switch-auth">
            {isSignup ? "Already have an account?" : "New to StockFlow?"}{" "}
            <button
              className="text-button"
              onClick={() => {
                setIsSignup(!isSignup);
                setError("");
                setNotice("");
              }}
            >
              {isSignup ? "Log in" : "Create an account"}
            </button>
          </p>
        </section>
      </main>
    );
  }

  if (pageLoading) {
    return <div className="loading-screen">Loading your inventory...</div>;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1 className="brand">StockFlow</h1>
          <p className="topbar-subtitle">Inventory Management</p>
        </div>

        <div className="topbar-right">
          <span className="user-email">{session.user.email}</span>
          <button className="secondary-button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <main className="main-content">
        {error && <div className="alert error-alert">{error}</div>}
        {notice && <div className="alert success-alert">{notice}</div>}

        <section className="welcome-row">
          <div>
            <p className="eyebrow">INVENTORY OVERVIEW</p>
            <h2>{organization?.name || "My Organization"}</h2>
            <p className="muted">
              Track products, stock levels, and inventory activity.
            </p>
          </div>

          <button className="primary-button" onClick={openAddForm}>
            + Add Product
          </button>
        </section>

        <section className="stats-grid">
          <div className="stat-card">
            <span className="stat-label">Total Products</span>
            <strong>{products.length}</strong>
            <span className="stat-note">Products in your inventory</span>
          </div>

          <div className="stat-card">
            <span className="stat-label">Total Stock Quantity</span>
            <strong>{totalQuantity.toLocaleString()}</strong>
            <span className="stat-note">Units across all products</span>
          </div>

          <div className="stat-card">
            <span className="stat-label">Low-Stock Items</span>
            <strong className={lowStockProducts.length ? "warning-number" : ""}>
              {lowStockProducts.length}
            </strong>
            <span className="stat-note">Products needing attention</span>
          </div>
        </section>

        {showForm && (
          <section className="panel product-form-panel">
            <div className="section-heading">
              <div>
                <h3>{editingProduct ? "Edit Product" : "Add New Product"}</h3>
                <p className="muted">
                  Enter the product details below.
                </p>
              </div>

              <button
                className="icon-button"
                type="button"
                onClick={() => setShowForm(false)}
                aria-label="Close form"
              >
                ✕
              </button>
            </div>

            <form className="product-form" onSubmit={saveProduct}>
              <label>
                Product Name *
                <input
                  name="name"
                  value={form.name}
                  onChange={updateForm}
                  placeholder="Wireless Mouse"
                  required
                />
              </label>

              <label>
                SKU *
                <input
                  name="sku"
                  value={form.sku}
                  onChange={updateForm}
                  placeholder="WM-001"
                  required
                />
              </label>

              <label className="wide-field">
                Description
                <textarea
                  name="description"
                  value={form.description}
                  onChange={updateForm}
                  placeholder="Product description"
                  rows="3"
                />
              </label>

              <label>
                Quantity *
                <input
                  type="number"
                  name="quantity"
                  min="0"
                  step="1"
                  value={form.quantity}
                  onChange={updateForm}
                  required
                />
              </label>

              <label>
                Cost Price
                <input
                  type="number"
                  name="cost_price"
                  min="0"
                  step="0.01"
                  value={form.cost_price}
                  onChange={updateForm}
                  placeholder="0.00"
                />
              </label>

              <label>
                Selling Price
                <input
                  type="number"
                  name="selling_price"
                  min="0"
                  step="0.01"
                  value={form.selling_price}
                  onChange={updateForm}
                  placeholder="0.00"
                />
              </label>

              <label>
                Low-Stock Threshold
                <input
                  type="number"
                  name="low_stock_threshold"
                  min="0"
                  step="1"
                  value={form.low_stock_threshold}
                  onChange={updateForm}
                  placeholder={`Default: ${organization?.default_low_stock_threshold ?? 5}`}
                />
                <small>Leave blank to use your organization's default.</small>
              </label>

              <div className="form-actions wide-field">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>

                <button className="primary-button" disabled={busy}>
                  {busy
                    ? "Saving..."
                    : editingProduct
                      ? "Save Changes"
                      : "Save Product"}
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="panel inventory-panel">
          <div className="section-heading inventory-heading">
            <div>
              <h3>Products</h3>
              <p className="muted">
                View and manage your inventory.
              </p>
            </div>

            <input
              className="search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or SKU..."
              aria-label="Search products by name or SKU"
            />
          </div>

          {products.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">▤</div>
              <h3>No products yet</h3>
              <p className="muted">
                Add your first product to start tracking inventory.
              </p>
              <button className="primary-button" onClick={openAddForm}>
                + Add Your First Product
              </button>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="empty-state">
              <h3>No matching products</h3>
              <p className="muted">Try another product name or SKU.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Quantity</th>
                    <th>Cost Price</th>
                    <th>Selling Price</th>
                    <th>Stock Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredProducts.map((product) => {
                    const threshold =
                      product.low_stock_threshold ??
                      organization?.default_low_stock_threshold ??
                      5;

                    const isLow = Number(product.quantity) <= Number(threshold);

                    return (
                      <tr key={product.id}>
                        <td>
                          <strong>{product.name}</strong>
                          {product.description && (
                            <small className="description-cell">
                              {product.description}
                            </small>
                          )}
                        </td>
                        <td>
                          <span className="sku-badge">{product.sku}</span>
                        </td>
                        <td>{product.quantity}</td>
                        <td>
                          {product.cost_price == null
                            ? "—"
                            : `₹${Number(product.cost_price).toFixed(2)}`}
                        </td>
                        <td>
                          {product.selling_price == null
                            ? "—"
                            : `₹${Number(product.selling_price).toFixed(2)}`}
                        </td>
                        <td>
                          <span
                            className={`status-badge ${
                              isLow ? "status-low" : "status-good"
                            }`}
                          >
                            {isLow ? "Low Stock" : "In Stock"}
                          </span>
                        </td>
                        <td>
                          <div className="action-buttons">
                            <button
                              className="edit-button"
                              onClick={() => openEditForm(product)}
                            >
                              Edit
                            </button>
                            <button
                              className="delete-button"
                              onClick={() => deleteProduct(product)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel settings-panel">
          <div>
            <h3>Inventory Settings</h3>
            <p className="muted">
              Set the default quantity at which a product is marked low-stock.
            </p>
          </div>

          <form className="threshold-form" onSubmit={saveDefaultThreshold}>
            <label>
              Default low-stock threshold
              <input
                type="number"
                min="0"
                step="1"
                value={defaultThreshold}
                onChange={(e) => setDefaultThreshold(e.target.value)}
                required
              />
            </label>
            <button className="secondary-button">Save Setting</button>
          </form>
        </section>

        <footer className="footer">
          StockFlow · Inventory Management System
        </footer>
      </main>
    </div>
  );
}

export default App;