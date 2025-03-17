// server.js - Complete server for handling Stripe payments

require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Initialize Express
const app = express();

// Initialize Stripe with proper error handling
let stripe;
try {
  // Replace with your own secret key or use environment variable
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  console.log("Stripe initialized successfully");
} catch (error) {
  console.error("Failed to initialize Stripe:", error);
  process.exit(1); // Exit if Stripe fails to initialize
}

// Configure CORS for both local development and production
app.use(cors({
    origin: [
      'http://localhost:5500',     // Local dev server
      'http://127.0.0.1:5500',     // Local dev server alternative
      'https://kenyaonabudgetsafaris.co.uk' // Production site
    ],
    credentials: true
}));

// Configure Express to parse JSON request bodies
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
      status: 'healthy',
      timestamp: new Date().toISOString()
    });
});

// Create checkout session endpoint
app.post('/create-checkout-session', async (req, res) => {
    try {
        console.log("Received checkout request:", req.body);
        
        const { userId, amount, items, type, packageId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: 'Missing userId' });
        }

        if (!amount && !items) {
            return res.status(400).json({ error: 'Missing payment details (amount or items)' });
        }

        const timestamp = Date.now();
        
        // Create line items differently based on checkout type
        let lineItems = [];
        
        if (type === 'activity_upgrade' && Array.isArray(items) && items.length > 0) {
            // Handle activity upgrade checkout with individual line items
            console.log("Processing activity upgrade with items:", items);
            
            lineItems = items.map(item => ({
                price_data: {
                    currency: 'gbp',
                    product_data: {
                        name: item.title || 'Activity',
                        description: `Quantity: ${item.quantity || 1}`
                    },
                    unit_amount: Math.round((item.price || 0) * 100), // Convert to pence
                },
                quantity: item.quantity || 1
            }));
            
            console.log("Created line items for activities:", lineItems);
        } else {
            // Original package booking behavior
            console.log("Processing package booking with amount:", amount);
            
            lineItems = [{
                price_data: {
                    currency: 'gbp',
                    product_data: {
                        name: 'Travel Package Booking',
                    },
                    unit_amount: Math.round(amount * 100), // Convert to pence
                },
                quantity: 1,
            }];
        }

        // Create success and cancel URLs
        const successUrl = `https://kenyaonabudgetsafaris.co.uk/payment-successa.html?session_id={CHECKOUT_SESSION_ID}&userId=${userId}&timestamp=${timestamp}&type=${type || 'package'}`;
        const cancelUrl = `https://kenyaonabudgetsafaris.co.uk/payment-cancelled.html?userId=${userId}&timestamp=${timestamp}`;

        // For local testing, use different URLs
        const isLocal = req.headers.origin && (req.headers.origin.includes('localhost') || req.headers.origin.includes('127.0.0.1'));
        if (isLocal) {
            // Use localhost URLs for local development
            const localOrigin = req.headers.origin || 'http://localhost:5500';
            const successUrl = `${localOrigin}/payment-success.html?session_id={CHECKOUT_SESSION_ID}&userId=${userId}&timestamp=${timestamp}&type=${type || 'package'}`;
            const cancelUrl = `${localOrigin}/payment-cancelled.html?userId=${userId}&timestamp=${timestamp}`;
        }

        console.log("Creating Stripe checkout session...");
        console.log("Success URL:", successUrl);
        console.log("Cancel URL:", cancelUrl);

        // Create the Stripe checkout session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            success_url: successUrl,
            cancel_url: cancelUrl,
            client_reference_id: userId,
            metadata: {
                userId: userId,
                timestamp: timestamp.toString(),
                packageId: packageId || '',
                type: type || 'package',
                itemCount: items ? items.length : 1
            }
        });

        // Log and respond with session info
        console.log("Stripe session created:", session.id);
        res.json({ 
            id: session.id,
            timestamp: timestamp,
            success: true
        });
    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({ 
            error: error.message || 'Error creating checkout session',
            success: false
        });
    }
});

// GET method for the checkout endpoint (for error handling)
app.get('/create-checkout-session', (req, res) => {
    res.status(405).json({ 
        error: 'GET method not allowed for this endpoint. Use POST instead.',
        success: false
    });
});

// Verify payment endpoint
app.post('/verify-payment', async (req, res) => {
    try {
        console.log("Received payment verification request:", req.body);
        
        const { sessionId } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({ 
                error: 'Session ID is required',
                success: false
            });
        }

        console.log("Retrieving session from Stripe:", sessionId);
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        console.log("Session retrieved:", session.id, "Status:", session.payment_status);

        if (session.payment_status === 'paid') {
            res.json({
                paid: true,
                amount: session.amount_total / 100,
                customerId: session.customer,
                metadata: session.metadata,
                success: true
            });
        } else {
            res.json({ 
                paid: false,
                status: session.payment_status,
                metadata: session.metadata,
                success: true
            });
        }
    } catch (error) {
        console.error('Error verifying payment:', error);
        res.status(500).json({ 
            error: error.message || 'Error verifying payment',
            success: false
        });
    }
});

// Handle cancellation endpoint
app.post('/handle-cancellation', async (req, res) => {
    try {
        console.log("Received cancellation request:", req.body);
        
        const { userId, timestamp } = req.body;
        
        if (!userId) {
            return res.status(400).json({ 
                error: 'User ID is required',
                success: false
            });
        }

        // In a real implementation, you would update your database
        // to mark the payment attempt as cancelled

        res.json({ 
            success: true,
            message: 'Cancellation processed',
            userId,
            timestamp
        });
    } catch (error) {
        console.error('Error handling cancellation:', error);
        res.status(500).json({ 
            error: error.message || 'Error handling cancellation',
            success: false
        });
    }
});

// Basic error handling for undefined routes
app.use((req, res) => {
    res.status(404).json({
        error: `Route not found: ${req.method} ${req.url}`,
        success: false
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check available at: http://localhost:${PORT}/health`);
});
