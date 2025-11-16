import IncomingItem from '../models/IncomingItem.js';

// @desc    Get all incoming items
// @route   GET /api/incoming-items
// @access  Public
export const getIncomingItems = async (req, res, next) => {
  try {
    const items = await IncomingItem.find({ received: false });
    res.status(200).json({ 
      success: true, 
      count: items.length, 
      data: items 
    });
  } catch (err) {
    res.status(400).json({ 
      success: false 
    });
  }
};

// @desc    Receive an incoming item
// @route   PUT /api/incoming-items/:id
// @access  Private
export const receiveIncomingItem = async (req, res, next) => {
  try {
    const item = await IncomingItem.findByIdAndUpdate(
      req.params.id,
      { received: true },
      { new: true }
    );
    if (!item) {
      return res.status(404).json({ 
        success: false 
      });
    }
    // You would also update your stock here
    res.status(200).json({ 
      success: true, 
      data: item 
    });
  } catch (err) {
    res.status(400).json({ 
      success: false 
    });
  }
};