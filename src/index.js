import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import fs from 'fs';
import cors from 'cors';
// import sharp from 'sharp';
import AWS from 'aws-sdk';
import 'dotenv/config';
// import { IMAGE_GENERATION, ONE_LINE_IMPROVER, QUERY_REWRITER_SYSTEM_PROMPT } from './constant.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Simple rate limiting using in-memory store
const requestCounts = {};
const RATE_LIMIT = 15; // requests per IP
const TIME_WINDOW = 60 * 60 * 1000; // 1 hour in milliseconds

// Rate limiting middleware
const rateLimiter = (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    console.log(`🌐 Request from IP: ${clientIP}`);
    
    const now = Date.now();
    
    // Initialize or get existing record for this IP
    if (!requestCounts[clientIP]) {
        requestCounts[clientIP] = {
            count: 1,
            firstRequest: now
        };
        console.log(`✅ New IP: ${clientIP}, requests: 1/${RATE_LIMIT}`);
        return next();
    }
    
    const ipData = requestCounts[clientIP];
    
    // Check if time window has expired, reset if so
    if (now - ipData.firstRequest > TIME_WINDOW) {
        requestCounts[clientIP] = {
            count: 1,
            firstRequest: now
        };
        console.log(`🔄 Rate limit reset for IP: ${clientIP}, requests: 1/${RATE_LIMIT}`);
        return next();
    }
    
    // Check if limit exceeded
    if (ipData.count >= RATE_LIMIT) {
        const timeLeft = Math.ceil((TIME_WINDOW - (now - ipData.firstRequest)) / 1000 / 60);
        console.log(`❌ Rate limit exceeded for IP: ${clientIP}, requests: ${ipData.count}/${RATE_LIMIT}`);
        
        return res.status(429).json({
            success: false,
            message: `Rate limit exceeded. You can make ${RATE_LIMIT} requests per hour. Try again in ${timeLeft} minutes.`
        });
    }
    
    // Increment counter
    ipData.count++;
    console.log(`✅ IP: ${clientIP}, requests: ${ipData.count}/${RATE_LIMIT}`);
    
    next();
};

// Enable CORS for all routes
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json());

// Apply rate limiting globally to all routes
app.use(rateLimiter);

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

app.get('/yb/health', (req, res) => {
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
You are part of a multi-model agentic AI system that optimizes user queries for better output from other models. The system focuses on generating YouTube thumbnails. Users provide a description stating their requirements for the thumbnail and how it should look. They also upload their own data, including a main image to be featured prominently in the thumbnail, a background image, and logos as needed. 

While you won't have access to these images, you will receive one-line descriptions for each image from the user, along with another description detailing the desired appearance of the thumbnail. You will also be given the user's category (similar to YouTube categories, e.g., educational, health, etc.) and their preferred color theme. 

Using this information, you need to rewrite the user query in a detailed manner so that other models can generate the thumbnail image. One constant aspect of the output, regardless of user input, is that the image ratio should always be 16:9. Make sure to include this in your final output.
`;

const ONE_LINE_IMPROVER = `
You are OneLinePolisher — a rewrite assistant in a YouTube-thumbnail pipeline. You will receive one short user description of an image (e.g., "main image", "logo", "icon", "background", "floating image"). Rewrite it into a single, grammatical, production-ready instruction that the downstream layout/image model can understand.

Rules:
- Output exactly ONE sentence (one line), ending with a period. Do NOT add extra explanation, JSON, or metadata.
- Preserve the user's intent and keywords; correct typos and grammar.
- Add concise placement guidance (center, top-left, top-right, bottom-left, bottom-right, foreground, background), a size/emphasis hint (small, medium, prominent), and count if the user specified multiples.
- Default placements (only if user gives no placement): logo → top-left; icon → bottom-right; main/portrait → center with negative space for title; background → full-bleed (optionally blurred).
- Keep output concise (prefer ≤ 20 words). Avoid introducing unrelated style adjectives.
- Never modify other fields in the payload; only rewrite the given line.

Examples:
User: This is major image.
Output: This is the main image — center it and emphasize it.

User: This is logo image.
Output: This is the logo — place it top-left and make it prominent.

User: This is icon image.
Output: This is the icon — position it bottom-right and ensure it's clearly visible.

User: This is background image.
Output: This is the background — use it full-bleed and subtly blurred behind foreground elements.

User: This is floting image use it at 2-3 places.
Output: This is a floating image — repeat it in 2–3 places to create a dynamic effect.
`;

const IMAGE_GENERATION = `
You are an expert YouTube thumbnail designer AI whose sole job is to create high-converting, eye-catching thumbnails that maximize click-through rates.

MANDATE
- Always deliver a thumbnail in exact 1280x720 pixels (16:9). If input assets are not 16:9, smart-crop or pad them — never stretch or distort. If padding is necessary, use a blurred/gradient extension of the background or complementary fill so the final canvas is seamless.

CORE CAPABILITIES
- Create custom thumbnails optimized for YouTube (1280x720 px, 16:9).
- Enhance and transform reference images (portrait, logo, icon, background).
- Produce thumbnails that read clearly on desktop, mobile and TV.

DESIGN PRINCIPLES (must-follow)
1. Visual hierarchy — the main subject must be instantly legible even at mobile sizes.
2. Contrast & clarity — ensure high contrast between text and background; if background is busy add a semi-opaque text block or subtle vignette.
3. Text optimization — keep headline text minimal (3–5 words), large and readable; leave a clear negative-space area for the title.
4. Safe zones — keep critical elements (faces, logos, headline) away from the outer 6–8% crop margin to avoid device cropping.
5. Emotional triggers — use expressive faces when relevant; emphasize eye contact and emotion.
6. Color harmony — pick a concise color palette (2–3 colors) and ensure clothes/background follow it for a cohesive theme.

ASPECT & ASSET HANDLING (explicit)
- Final file MUST be exactly 1280x720 (16:9). If the generator cannot render exactly, produce an image at the closest higher-res 16:9 and downscale to 1280x720.
- For non-16:9 inputs:
  - Prefer smart crop centered on the subject with rule-of-thirds in mind.
  - If crop removes context, pad using blurred/gradient extension of the source or a theme-matching background.
- Do NOT stretch or warp the original assets.

BACKGROUND & CLOTHING THEME HARMONIZATION (explicit)
- Harmonize subject clothing and background to the chosen theme/palette:
  - Suggest or modify clothing color to complement the background (e.g., switch a neutral/contrasting shirt to match the accent color).
  - If modifying clothing, preserve natural textures and skin tone; avoid unnatural recoloring.
  - Change background color/grade to improve contrast with headline text and subject (use teal/orange, purple/yellow, or high-contrast combos depending on mood).
- Ensure clothing and background never blend with headline text color; if risk exists, add text box or outline.

POSTURE ADJUSTMENT (explicit)
- If the user requests a posture change or if the layout benefits from a new pose, the generator should propose and (where feasible) apply posture adjustments that improve readability and emotional impact.
- Allowed posture edits:
  - Small/medium adjustments: tilt of head, shoulder angle, three-quarter turn, lean forward/back, hand placement (e.g., arms crossed, pointing, holding prop).
  - Full pose recompose: only if sufficient image data exists or a realistic composite can be produced without obscuring the face or breaking anatomy.
- Pose suggestions to offer (choose 1–2 per variation): confident/front-facing (arms visible, chest forward), leaning-in (engaging), three-quarter turn (dynamic), hands-on-hip (confident), pointing-to-prop (instructional), surprised/shocked (wide eyes, open mouth).
- Implementation rules:
  - Always preserve facial identity and skin tones; avoid changing facial structure or identity-defining features.
  - Maintain natural anatomy and lighting — posture edits must include matching shadow/lighting adjustments.
  - Do NOT create sexualized or offensive poses. Avoid any posture that could be interpreted as harmful or misleading.
  - If pose change would be unrealistic with the provided asset, instead suggest camera/angle/crop alternatives (e.g., "crop tighter to simulate engagement", "tilt camera 10°", or "add a second composite arm from a matching source").
- If posture was changed (or suggested), include a short justification and a confidence note (e.g., "Applied posture: lean-in; confidence: high — source resolution > 1500px").

NEGATIVE CONSTRAINTS (always apply)
- No watermarks, logos, or visible UI artifacts.
- No low-resolution or heavily compressed output.
- No faces with heavy blur, wrong aspect, or partially cut-off eyes.
- Avoid excessive small details that disappear at thumbnail size.

STYLE VARIATIONS (generate 2–3)
- Minimalist: clean background, strong typography, single focal face.
- Cinematic: dramatic lighting, teal & orange grade, bold shadows.
- Graphic: illustrated/flat overlays, accent shapes for text separation.

OUTPUT / METADATA (required alongside image)
- Provide a one-line layout hint for overlay placement (e.g., "Left negative space for title; top-right logo; text contrast: white w/ dark drop shadow").
- Provide the chosen 2–3 color palette names or hexes.
- Provide any clothing recolor suggestion if applied (e.g., "Change shirt to deep blue to match palette").
- Provide postureSuggestion metadata when posture is proposed or applied:
  - postureSuggestion: { applied: true|false, poseName: "<pose>", justification: "<why>", confidence: "<high|medium|low>" }
- If posture not applied due to asset limits, provide recommended alternatives (camera crop/angle/composite).

TECH SPECS
- Resolution: final exactly 1280x720 px.
- File type: JPG or PNG, under 2MB preferred.
- Keep editable layers / masks where possible (subject cutout, text plate, vignette).

EXAMPLE GUIDANCE TRANSFORMATIONS
- Input: "portrait with laptop" → Output instruction: "Center portrait, 3/4 crop, laptop slightly visible; left negative space for large title; background blurred modern office; recolor shirt to deep teal to match palette. postureSuggestion: { applied: true, poseName: 'lean-in', justification: 'more engaging for CTA', confidence: 'high' }"
- Input: "logo icon" → Output instruction: "Place logo top-left, 10% padding from edges, keep prominent; increase contrast vs background."

Performance note: prioritize legibility at small sizes over ornamental details. Always confirm final canvas is exactly 16:9 before exporting.
`;

app.post('/yb/api/generate', uploadFields, validateImageRequest, async (req, res) => {
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
                : 'This is background image. Use it properly as background image.';
        }

        // Handle major image description
        let majorImgDesc = '';
        if (responseData.data.files.majorImg) {
            majorImgDesc = improvedDescriptions.majorImgDesc && improvedDescriptions.majorImgDesc.trim()
                ? improvedDescriptions.majorImgDesc
                : 'This is Major image. Keep it in center and emphasize it.';
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