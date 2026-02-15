import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { Op, UniqueConstraintError, ValidationError } from 'sequelize';
import { User, CustomerProfile, sequelize } from '../models';
import { generateToken } from '../middleware/authMiddleware';
import { getWhatsappLookupCandidates, normalizeWhatsappNumber } from '../utils/whatsappNumber';

export const register = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { name, email, password, whatsapp_number } = req.body;
        const normalizedName = typeof name === 'string' ? name.trim() : '';
        const normalizedEmail = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
        const normalizedWhatsapp = normalizeWhatsappNumber(whatsapp_number);

        // Validation
        if (!normalizedName || !password || !normalizedWhatsapp) {
            await t.rollback();
            return res.status(400).json({ message: 'Name, password, and valid WhatsApp number are required' });
        }

        // Check existing
        const whatsappCandidates = getWhatsappLookupCandidates(normalizedWhatsapp);
        const conflictConditions: Array<Record<string, unknown>> = [
            { whatsapp_number: { [Op.in]: whatsappCandidates } },
        ];
        if (normalizedEmail) {
            conflictConditions.push({ email: normalizedEmail });
        }

        const existingUser = await User.findOne({
            where: {
                [Op.or]: conflictConditions
            },
            transaction: t
        });

        if (existingUser) {
            await t.rollback();
            return res.status(409).json({ message: 'User with this Email or WhatsApp number already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await User.create({
            name: normalizedName,
            email: normalizedEmail,
            password: hashedPassword,
            whatsapp_number: normalizedWhatsapp,
            role: 'customer', // Default role
            status: 'active',
            debt: 0
        }, { transaction: t });

        // Create Profile
        await CustomerProfile.create({
            user_id: user.id,
            tier: 'regular',
            credit_limit: 0,
            points: 0,
            saved_addresses: []
        }, { transaction: t });

        await t.commit();

        const token = generateToken({ id: user.id, role: user.role, whatsapp_number: user.whatsapp_number });

        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: {
                id: user.id,
                name: user.name,
                role: user.role,
                email: user.email,
                whatsapp_number: user.whatsapp_number
            }
        });

    } catch (error) {
        try { await t.rollback(); } catch { }
        console.error('Register error:', error);
        if (error instanceof UniqueConstraintError) {
            return res.status(409).json({ message: 'Email atau nomor WhatsApp sudah terdaftar' });
        }
        if (error instanceof ValidationError) {
            return res.status(400).json({
                message: 'Data registrasi tidak valid',
                errors: error.errors.map((e) => e.message)
            });
        }
        res.status(500).json({ message: 'Registration failed' });
    }
};

export const login = async (req: Request, res: Response) => {
    try {
        const { email, whatsapp_number, password } = req.body;
        const normalizedEmail = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : '';
        const normalizedWhatsapp = normalizeWhatsappNumber(whatsapp_number);

        // Allow login by Email OR WhatsApp
        if (!password || (!normalizedEmail && !normalizedWhatsapp)) {
            return res.status(400).json({ message: 'Password and Email/WhatsApp are required' });
        }

        const whereClause: any = {};
        if (normalizedEmail) {
            whereClause.email = normalizedEmail;
        } else if (normalizedWhatsapp) {
            const whatsappCandidates = getWhatsappLookupCandidates(normalizedWhatsapp);
            whereClause.whatsapp_number = { [Op.in]: whatsappCandidates };
        }

        const user = await User.findOne({ where: whereClause });

        if (!user || !user.password) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        if (user.status === 'banned') {
            return res.status(403).json({ message: 'Account is banned' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = generateToken({ id: user.id, role: user.role, whatsapp_number: user.whatsapp_number });

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                name: user.name,
                role: user.role,
                tier: 'regular', // Ideally fetch from profile, but skipped for brevity
                email: user.email,
                whatsapp_number: user.whatsapp_number
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Login failed', error });
    }
};
