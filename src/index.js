import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import fs from 'fs';
// import sharp from 'sharp';
import AWS from 'aws-sdk';
import 'dotenv/config';
// import { IMAGE_GENERATION, ONE_LINE_IMPROVER, QUERY_REWRITER_SYSTEM_PROMPT } from './constant.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Configure multer for file uploads
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpg', 'image/jpeg'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only PNG, JPG, and JPEG files are allowed'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 3MB limit
    },
});

const uploadFields = upload.fields([
    { name: 'bgImg', maxCount: 1 },
    { name: 'majorImg', maxCount: 1 },
    { name: 'imgIcons', maxCount: 5 }
]);

const imgGenerator = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPEN_ROUTER,
});

// Configure AWS
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});

const s3 = new AWS.S3();

const uploadBase64ToS3 = async (base64Data, fileName, contentType = 'image/png') => {
    try {
        console.log('☁️ Uploading image to S3...');

        // Remove the data URL prefix if present
        const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, '');

        // Convert base64 to buffer
        const buffer = Buffer.from(base64Image, 'base64');

        // Generate unique filename
        const key = `generated-images/${fileName}`;

        const uploadParams = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key,
            Body: buffer,
            ContentType: contentType,
            // ACL: 'public-read', // Make image publicly accessible
        };

        const result = await s3.upload(uploadParams).promise();
        console.log('✅ Image uploaded to S3 successfully');

        return {
            success: true,
            url: result.Location,
            key: key,
            etag: result.ETag
        };

    } catch (error) {
        console.log('❌ S3 upload error:', error.message);
        return {
            success: false,
            error: `S3 upload failed: ${error.message}`
        };
    }
};

// Validation middleware for file uploads
const validateImageRequest = (req, res, next) => {
    console.log('🔍 Starting request validation...');

    const { bgImgDescription, majorImgDescription, imgDescriptions, finalDescription, themeColor, category } = req.body;
    const files = req.files;

    const errors = [];

    // Required fields
    if (!finalDescription) {
        console.log('❌ Missing finalDescription');
        errors.push('finalDescription is required');
    }
    if (!themeColor) {
        console.log('❌ Missing themeColor');
        errors.push('themeColor is required');
    }
    if (!category) {
        console.log('❌ Missing category');
        errors.push('category is required');
    }

    // Validate hex color
    if (themeColor && !/^#[0-9A-Fa-f]{6}$/.test(themeColor)) {
        console.log('❌ Invalid hex color format:', themeColor);
        errors.push('themeColor must be a valid hex color code');
    } else if (themeColor) {
        console.log('✅ Valid hex color:', themeColor);
    }

    // Validate imgIcons and their descriptions
    const hasImgIcons = files && files.imgIcons && files.imgIcons.length > 0;

    if (hasImgIcons) {
        console.log(`📎 Found ${files.imgIcons.length} icon files`);

        if (files.imgIcons.length > 5) {
            console.log('❌ Too many icon files');
            errors.push('Maximum 5 icon images allowed');
        }

        // If imgIcons are provided, descriptions are required
        if (!imgDescriptions) {
            console.log('❌ Missing imgDescriptions for provided icons');
            errors.push('imgDescriptions is required when imgIcons are provided');
        } else {
            try {
                const descriptions = JSON.parse(imgDescriptions);
                if (!Array.isArray(descriptions)) {
                    console.log('❌ imgDescriptions is not an array');
                    errors.push('imgDescriptions must be a valid JSON array');
                } else {
                    if (descriptions.length !== files.imgIcons.length) {
                        console.log(`❌ Mismatch: ${descriptions.length} descriptions vs ${files.imgIcons.length} icons`);
                        errors.push('Number of imgDescriptions must match number of imgIcons');
                    }
                    if (descriptions.length > 5) {
                        console.log('❌ Too many descriptions');
                        errors.push('Maximum 5 image descriptions allowed');
                    }
                    if (descriptions.length === files.imgIcons.length && descriptions.length <= 5) {
                        console.log('✅ Icon descriptions validation passed');
                    }
                }
            } catch (e) {
                console.log('❌ Failed to parse imgDescriptions JSON:', e.message);
                errors.push('imgDescriptions must be a valid JSON array');
            }
        }
    } else {
        console.log('📎 No icon files provided');

        // If no imgIcons, validate imgDescriptions format if provided
        if (imgDescriptions) {
            try {
                const descriptions = JSON.parse(imgDescriptions);
                if (!Array.isArray(descriptions) || descriptions.length > 5) {
                    console.log('❌ Invalid imgDescriptions format');
                    errors.push('imgDescriptions must be an array with maximum 5 items');
                }
            } catch (e) {
                console.log('❌ Failed to parse imgDescriptions JSON:', e.message);
                errors.push('imgDescriptions must be a valid JSON array');
            }
        }
    }

    if (errors.length > 0) {
        console.log(`❌ Validation failed with ${errors.length} errors:`, errors);
        return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    console.log('✅ Request validation passed');
    next();
};

app.get('/health', (req, res) => {
    console.log('🩺 Health check requested');
    res.status(200).json({
        status: 'OK',
        message: 'Server is healthy',
        timestamp: new Date().toISOString()
    });
});

const openai = new OpenAI();

// AI System Prompts
const QUERY_REWRITER_SYSTEM_PROMPT = `
You are an part of multi model agentic AI system, where you will get user query and you need to optmize it further so that other model can work on your query to give batter output.
so system is working around youtube thumbnail generator. where you will get description from user in which user will mention about what they want and how thumbnail should looks like. user also has uploaded their own data like main img prominent one in thumbnail, bg img, logs as per need. now you will not get access to this imgs but you will get one line desription for each one of this and another description whihc user provide in which they mention about how thumbnail looks like. you will also get users category ( same as youtube category ex: educational, health, etc... ) you will also get their color theme. by using these data you need to rewrite user query in detailed manner so that other model can use your query and generate img. one thing which will constant regardless of users input which is img ration it should be always 16:9 this is fixed and you need to always add this in your final output.
`;

const ONE_LINE_IMPROVER = `
You are an part of multi model agentic AI system, where you will get part of user query which you need to rewrite so other model can understand it properly. so system is working around youtube thumbnail generator. where you will get users one line description of background img or main img or icon img you need to rewrite this description in batter format so other model can understnad it better. you just need to rewrite that only don't mess up with other data.
`;

const IMAGE_GENERATION = `
You are an expert YouTube thumbnail designer specializing in creating high-converting, eye-catching thumbnails that maximize click-through rates. Your goal is to generate compelling thumbnail images that stop viewers from scrolling and entice them to click.

## Core Capabilities
- Create custom thumbnails optimized for YouTube's platform requirements (1280x720 pixels, 16:9 aspect ratio)
- Enhance and transform existing reference images provided by users
- Design thumbnails that work effectively across all devices (desktop, mobile, TV)

## Design Principles
1. **Visual Hierarchy**: Ensure the main subject is immediately clear, even at small sizes
2. **Contrast & Clarity**: Use high contrast colors and bold elements that stand out in YouTube's interface
3. **Text Optimization**: 
   - Keep text minimal (3-5 words maximum)
   - Use large, bold, readable fonts
   - Ensure text is legible on mobile devices
4. **Emotional Triggers**: Incorporate faces with expressive emotions when relevant
5. **Color Psychology**: Use vibrant, contrasting colors that grab attention (consider YouTube's dark/light modes)
6. **Rule of Thirds**: Position key elements strategically for maximum visual impact

## Technical Specifications
- Resolution: 1280x720 pixels minimum
- File size: Under 2MB
- Format: JPG, GIF, or PNG
- Safe zones: Keep critical elements away from edges (account for different device crops)

## Style Variations
Be prepared to create thumbnails in various styles:
- Minimalist and clean
- Busy and information-packed
- Gaming/entertainment style
- Educational/professional
- Lifestyle/vlog aesthetic
- News/documentary style

When users provide reference images, analyze what works and enhance by:
- Improving composition and focus
- Amplifying emotional impact
- Optimizing color grading
- Adding complementary graphic elements
- Ensuring YouTube optimization
`;

app.post('/api/generate', uploadFields, validateImageRequest, async (req, res) => {
    console.log('🚀 Starting image generation request...');

    const {
        bgImgDescription,
        majorImgDescription,
        imgDescriptions,
        finalDescription,
        themeColor,
        category
    } = req.body;

    const files = req.files;
    console.log('📁 Files received:', {
        bgImg: !!files?.bgImg,
        majorImg: !!files?.majorImg,
        imgIcons: files?.imgIcons?.length || 0
    });

    // Parse imgDescriptions if provided
    let parsedImgDescriptions = [];
    if (imgDescriptions) {
        try {
            parsedImgDescriptions = JSON.parse(imgDescriptions);
            console.log('📝 Parsed image descriptions:', parsedImgDescriptions.length);
        } catch (e) {
            console.log('❌ Failed to parse imgDescriptions:', e.message);
            parsedImgDescriptions = [];
        }
    }

    // Process the image generation request
    const responseData = {
        success: true,
        message: 'Image generation request received',
        data: {
            files: {
                bgImg: files.bgImg ? {
                    originalName: files.bgImg[0].originalname,
                    size: files.bgImg[0].size,
                    mimetype: files.bgImg[0].mimetype
                } : null,
                majorImg: files.majorImg ? {
                    originalName: files.majorImg[0].originalname,
                    size: files.majorImg[0].size,
                    mimetype: files.majorImg[0].mimetype
                } : null,
                imgIcons: files.imgIcons ? files.imgIcons.map(file => ({
                    originalName: file.originalname,
                    size: file.size,
                    mimetype: file.mimetype
                })) : []
            },
            descriptions: {
                bgImgDescription,
                majorImgDescription,
                imgDescriptions: parsedImgDescriptions,
                finalDescription
            },
            themeColor,
            category,
            timestamp: new Date().toISOString(),
            requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
        }
    };

    console.log(`🎨 Request ID: ${responseData.data.requestId}`);
    console.log(`🎯 Category: ${category}, Theme: ${themeColor}`);

    const queryRewriter = async (improvedDescriptions) => {
        console.log('🔄 Starting query rewriting process...');

        // Handle background image description
        let bgImgDesc = '';
        if (responseData.data.files.bgImg) {
            bgImgDesc = improvedDescriptions.bgImgDesc && improvedDescriptions.bgImgDesc.trim()
                ? improvedDescriptions.bgImgDesc
                : 'Background image is provided';
        }

        // Handle major image description
        let majorImgDesc = '';
        if (responseData.data.files.majorImg) {
            majorImgDesc = improvedDescriptions.majorImgDesc && improvedDescriptions.majorImgDesc.trim()
                ? improvedDescriptions.majorImgDesc
                : 'Major image is provided';
        }

        // Handle icon descriptions
        let iconDescs = '';
        if (responseData.data.files.imgIcons && responseData.data.files.imgIcons.length > 0) {
            if (improvedDescriptions.iconDescs && improvedDescriptions.iconDescs.length > 0) {
                iconDescs = improvedDescriptions.iconDescs.map((desc, idx) => {
                    return desc && desc.trim()
                        ? `Icon ${idx + 1} description: ${desc}.`
                        : `Icon ${idx + 1} is provided.`;
                }).join('\n');
            } else {
                iconDescs = responseData.data.files.imgIcons.map((_, idx) =>
                    `Icon ${idx + 1} is provided.`
                ).join('\n');
            }
        }

        console.log('💬 Calling OpenAI for query rewriting...');

        const aiResponse = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: QUERY_REWRITER_SYSTEM_PROMPT
                },
                {
                    role: 'user',
                    content: `
                    ${bgImgDesc !== '' ? bgImgDesc : ''}
                    \n
                    ${majorImgDesc !== '' ? majorImgDesc : ''}
                    \n
                    ${iconDescs !== '' ? iconDescs : ''}
                    \n
                    Category: ${category}
                    Theme Color: ${themeColor}
                    \n
                    Final Description: ${finalDescription}
                    `
                }
            ]
        });

        console.log('✅ Query rewriting completed');
        console.log('🔄 Query rewriter response:', aiResponse.choices[0].message.content);
        return aiResponse.choices[0].message.content;
    }

    const oneLineRewriter = async () => {
        console.log('🔧 Starting one-line description improvement...');

        const bgImgDesc = responseData.data.files.bgImg ? (responseData.data.descriptions.bgImgDescription || '') : '';
        const majorImgDesc = responseData.data.files.majorImg ? (responseData.data.descriptions.majorImgDescription || '') : '';
        const iconDescs = responseData.data.files.imgIcons && responseData.data.files.imgIcons.length > 0 ?
            (responseData.data.descriptions.imgDescriptions || []) : [];

        const promises = [];
        const results = {};

        // Only make API calls for non-empty descriptions
        if (bgImgDesc && bgImgDesc.trim()) {
            console.log('🎨 Improving background image description...');
            promises.push(
                openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        {
                            role: 'system',
                            content: ONE_LINE_IMPROVER
                        },
                        {
                            role: 'user',
                            content: bgImgDesc
                        }
                    ]
                }).then(response => {
                    results.bgImgDesc = response.choices[0].message.content;
                    console.log('🎨 Background image description improved:', response.choices[0].message.content);
                })
            );
        } else {
            results.bgImgDesc = bgImgDesc;
        }

        if (majorImgDesc && majorImgDesc.trim()) {
            console.log('🖼️ Improving major image description...');
            promises.push(
                openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        {
                            role: 'system',
                            content: ONE_LINE_IMPROVER
                        },
                        {
                            role: 'user',
                            content: majorImgDesc
                        }
                    ]
                }).then(response => {
                    results.majorImgDesc = response.choices[0].message.content;
                    console.log('🖼️ Major image description improved:', response.choices[0].message.content);
                })
            );
        } else {
            results.majorImgDesc = majorImgDesc;
        }

        // Process icon descriptions in parallel
        if (iconDescs.length > 0) {
            console.log(`🔧 Improving ${iconDescs.length} icon descriptions...`);
            results.iconDescs = [];

            iconDescs.forEach((desc, index) => {
                if (desc && desc.trim()) {
                    promises.push(
                        openai.chat.completions.create({
                            model: 'gpt-4o-mini',
                            messages: [
                                {
                                    role: 'system',
                                    content: ONE_LINE_IMPROVER
                                },
                                {
                                    role: 'user',
                                    content: desc
                                }
                            ]
                        }).then(response => {
                            results.iconDescs[index] = response.choices[0].message.content;
                            console.log(`🔧 Icon ${index + 1} description improved:`, response.choices[0].message.content);
                        })
                    );
                } else {
                    results.iconDescs[index] = desc;
                }
            });
        } else {
            results.iconDescs = [];
        }

        // Wait for all API calls to complete
        if (promises.length > 0) {
            console.log(`⏳ Waiting for ${promises.length} parallel API calls...`);
            await Promise.all(promises);
            console.log('✅ All description improvements completed');
        } else {
            console.log('ℹ️ No descriptions to improve');
        }

        return results;
    };

    try {
        // First improve descriptions with parallel calls
        console.log('🔧 Step 1: Improving individual descriptions...');
        const improvedDescriptions = await oneLineRewriter();

        // Then use improved descriptions for query rewriting
        console.log('🔄 Step 2: Rewriting complete query...');
        const rewrittenQuery = await queryRewriter(improvedDescriptions);

        console.log('🎨 Step 3: Preparing image generation request...');
        const messages = [], userContent = [];

        messages.push({
            role: "system",
            content: IMAGE_GENERATION
        });

        // Add the rewritten query as text
        userContent.push({
            "type": "text",
            "text": rewrittenQuery
        });

        if (responseData.data.files.bgImg) {
            console.log('🖼️ Adding background image to generation request...');
            const base64Image = files.bgImg[0].buffer.toString('base64');
            const imageUrl = `data:${files.bgImg[0].mimetype};base64,${base64Image}`;
            userContent.push({
                "type": "image_url",
                "image_url": {
                    "url": imageUrl,
                    "detail": "high"
                }
            });
            userContent.push({
                type: 'text',
                text: `Background image: ${improvedDescriptions.bgImgDesc || 'Background image is provided'}`
            });
        }

        if (responseData.data.files.imgIcons && responseData.data.files.imgIcons.length > 0) {
            console.log(`🔗 Adding ${responseData.data.files.imgIcons.length} icon images to generation request...`);
            files.imgIcons.forEach((img, idx) => {
                const base64Image = img.buffer.toString('base64');
                const imageUrl = `data:${img.mimetype};base64,${base64Image}`;
                userContent.push({
                    "type": "image_url",
                    "image_url": {
                        "url": imageUrl,
                        "detail": "high"
                    }
                });
                userContent.push({
                    type: 'text',
                    text: `Icon image ${idx + 1}: ${improvedDescriptions.iconDescs[idx] || 'Icon image is provided'}`
                });
            });
        }

        if (responseData.data.files.majorImg) {
            console.log('🎯 Adding major image to generation request...');
            const base64Image = files.majorImg[0].buffer.toString('base64');
            const imageUrl = `data:${files.majorImg[0].mimetype};base64,${base64Image}`;
            userContent.push({
                "type": "image_url",
                "image_url": {
                    "url": imageUrl,
                    "detail": "high"
                }
            });
            userContent.push({
                type: 'text',
                text: `Major image: ${improvedDescriptions.majorImgDesc || 'Major image is provided'}`
            });
        }

        const userMsg = {
            "role": "user",
            "content": userContent
        };
        messages.push(userMsg);

        console.log(`📊 Generation request prepared with ${userContent.length} content items`);
        console.log('🤖 Calling image generation API...');

        const completion = await imgGenerator.chat.completions.create({
            model: "google/gemini-2.5-flash-image-preview:free",
            messages: messages
        });

        const assistantMessage = completion.choices[0].message;

        // Check if images are present in the response
        if (assistantMessage.images && assistantMessage.images.length > 0) {
            console.log('✅ Image generated successfully!');
            console.log('💬 AI Response:', assistantMessage.content ? assistantMessage.content + '...' : 'No text response');
            console.log('🖼️ Image data received (first 100 chars):', assistantMessage.images[0].image_url.url.substring(0, 100) + '...');

            // Extract the base64 image data
            const imageData = assistantMessage.images[0].image_url.url;

            // Remove the data URL prefix (e.g., "data:image/png;base64,")
            const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');

            // Generate filename with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `generated-image-${timestamp}.png`;

            // Upload to S3
            const uploadResult = await uploadBase64ToS3(base64Data, filename, 'image/png');

            if (uploadResult.success) {
                console.log(`☁️ Image uploaded to S3: ${uploadResult.url}`);
                
                // Success response - flat structure
                const apiResponse = {
                    success: true,
                    message: 'Image generated and uploaded successfully',
                    url: uploadResult.url
                };
                
                console.log('📤 Sending success response');
                return res.status(200).json(apiResponse);
            } else {
                console.log(`❌ S3 upload failed: ${uploadResult.error}`);
                
                // Upload failed response
                const apiResponse = {
                    success: false,
                    message: `Image generated but upload failed: ${uploadResult.error}`
                };
                
                console.log('📤 Sending upload failure response');
                return res.status(500).json(apiResponse);
            }

        } else {
            console.log('⚠️ No image generated in AI response');
            console.log('💬 AI Response:', assistantMessage.content ? assistantMessage.content.substring(0, 100) + '...' : 'No response content');

            // No image generated response
            const apiResponse = {
                success: false,
                message: 'Image generation failed - no image returned by AI'
            };
            
            console.log('📤 Sending no image response');
            return res.status(400).json(apiResponse);
        }
    } catch (error) {
        console.log('❌ Error in image generation pipeline:', error.message);
        console.log('🔍 Error details:', error.stack);

        // Determine error type and provide appropriate response
        let errorMessage = 'Image generation pipeline failed';
        let statusCode = 500;

        if (error.message.includes('API')) {
            errorMessage = 'External API call failed';
            console.log('🌐 API call error detected');
        } else if (error.message.includes('parse') || error.message.includes('JSON')) {
            errorMessage = 'Data parsing error';
            console.log('📄 JSON parsing error detected');
        } else if (error.message.includes('file') || error.message.includes('write')) {
            errorMessage = 'File operation error';
            console.log('💾 File system error detected');
        }

        // Create minimal error response
        const errorResponse = {
            success: false,
            message: `${errorMessage}: ${error.message}`
        };

        res.status(statusCode).json(errorResponse);
    }
});

// Error handling middleware for multer
app.use((error, req, res, next) => {
    console.log('⚠️ Error caught by middleware:', error.message);

    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            console.log('❌ File size limit exceeded');
            return res.status(400).json({
                error: 'File too large',
                message: 'File size must be less than 3MB'
            });
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
            console.log('❌ Unexpected file field');
            return res.status(400).json({
                error: 'Invalid file field',
                message: 'Unexpected file field'
            });
        }
    }

    if (error.message === 'Only PNG, JPG, and JPEG files are allowed') {
        console.log('❌ Invalid file type uploaded');
        return res.status(400).json({
            error: 'Invalid file type',
            message: error.message
        });
    }

    console.log('💥 Internal server error:', error.message);
    res.status(500).json({
        error: 'Internal server error',
        message: error.message
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🩺 Health check: http://localhost:${PORT}/health`);
    console.log(`📸 Generate API: http://localhost:${PORT}/api/generate`);
    console.log(`☁️ S3 Bucket: ${process.env.AWS_BUCKET_NAME}`);
    console.log(`🌎 AWS Region: ${process.env.AWS_REGION}`);
});