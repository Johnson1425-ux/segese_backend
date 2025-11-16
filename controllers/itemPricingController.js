import ItemPrice from '../models/ItemPrice.js';

// @desc    Get all item prices
// @route   GET /api/item-pricing
// @access  Public
export const getItemPrices = async (req, res, next) => {
  try {
    const items = await ItemPrice.find();
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

// @desc    Create an item price
// @route   POST /api/item-pricing
// @access  Private
export const createItemPrice = async (req, res, next) => {
  try {
    const item = await ItemPrice.create(req.body);
    res.status(201).json({ 
      success: true, 
      data: item 
    });
  } catch (err) {
    res.status(400).json({ 
      success: false 
    });
  }
};

// @desc    Update an item price
// @route   PUT /api/item-pricing/:id
// @access  Private
export const updateItemPrice = async (req, res, next) => {
  try {
    const item = await ItemPrice.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!item) {
      return res.status(404).json({ 
        success: false 
      });
    }
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

// @desc    Delete an item price
// @route   DELETE /api/item-pricing/:id
// @access  Private
export const deleteItemPrice = async (req, res, next) => {
  try {
    const item = await ItemPrice.findByIdAndDelete(req.params.id);
    if (!item) {
      return res.status(404).json({ 
        success: false 
      });
    }
    res.status(200).json({ 
      success: true, 
      data: {} 
    });
  } catch (err) {
    res.status(400).json({ 
      success: false 
    });
  }
};