// ===============================================
// SERVIDOR BACKEND - SISTEMA DE DOAÇÕES BIBLIOTECA
// Arquivo: server.js  
// By Francisco Araújo
// ===============================================

const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ===============================================
// CONFIGURAÇÃO DO BANCO DE DADOS
// ===============================================

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'biblioteca_doacoes',
    password: process.env.DB_PASSWORD || 'senha',
    port: process.env.DB_PORT || 5432,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Teste de conexão
pool.on('connect', () => {
    console.log('📊 Conectado ao banco PostgreSQL');
});

pool.on('error', (err) => {
    console.error('❌ Erro na conexão com banco:', err);
});

// ===============================================
// CONFIGURAÇÃO DE MIDDLEWARES
// ===============================================

app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? process.env.FRONTEND_URL 
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware de log para debugging
app.use((req, res, next) => {
    if (process.env.NODE_ENV === 'development') {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    }
    next();
});

// ===============================================
// CONFIGURAÇÃO DO NODEMAILER
// ===============================================

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

// Verificar configuração de email
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter.verify((error, success) => {
        if (error) {
            console.error('❌ Erro na configuração de email:', error);
        } else {
            console.log('📧 Servidor de email configurado com sucesso');
        }
    });
}

// ===============================================
// MIDDLEWARE DE AUTENTICAÇÃO
// ===============================================

const verificarToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ 
            success: false, 
            message: 'Token de acesso requerido' 
        });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'chave-secreta-padrao');
        req.admin = decoded;
        next();
    } catch (error) {
        console.error('Token inválido:', error.message);
        return res.status(401).json({ 
            success: false, 
            message: 'Token inválido ou expirado' 
        });
    }
};

// ===============================================
// CLASSES DO DOMÍNIO
// ===============================================

class Doador {
    static async cadastrar(dadosDoador) {
        const { nomeCompleto, email, telefone } = dadosDoador;
        
        try {
            const result = await pool.query(
                'INSERT INTO doadores (nome_completo, email, telefone) VALUES ($1, $2, $3) RETURNING *',
                [nomeCompleto, email, telefone]
            );
            return { success: true, doador: result.rows[0] };
        } catch (error) {
            if (error.code === '23505') {
                return { success: false, message: 'Email já cadastrado no sistema' };
            }
            console.error('Erro ao cadastrar doador:', error);
            throw new Error('Erro interno ao cadastrar doador');
        }
    }

    static async buscarPorEmail(email) {
        try {
            const result = await pool.query(
                'SELECT * FROM doadores WHERE email = $1 AND ativo = true', 
                [email]
            );
            return result.rows[0] || null;
        } catch (error) {
            console.error('Erro ao buscar doador por email:', error);
            throw error;
        }
    }

    static async buscarPorId(id) {
        try {
            const result = await pool.query(
                'SELECT * FROM doadores WHERE id = $1 AND ativo = true', 
                [id]
            );
            return result.rows[0] || null;
        } catch (error) {
            console.error('Erro ao buscar doador por ID:', error);
            throw error;
        }
    }

    static async listar(limite = 100, offset = 0) {
        try {
            const result = await pool.query(
                'SELECT * FROM doadores WHERE ativo = true ORDER BY nome_completo LIMIT $1 OFFSET $2',
                [limite, offset]
            );
            return result.rows;
        } catch (error) {
            console.error('Erro ao listar doadores:', error);
            throw error;
        }
    }

    static validarDados(dadosDoador) {
        const { nomeCompleto, email, telefone } = dadosDoador;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const telefoneRegex = /^[\d\s\-\(\)\+]+$/;
        
        if (!nomeCompleto || nomeCompleto.trim().length < 2) {
            throw new Error('Nome completo deve ter pelo menos 2 caracteres');
        }
        
        if (!emailRegex.test(email)) {
            throw new Error('Email inválido');
        }
        
        if (!telefoneRegex.test(telefone)) {
            throw new Error('Telefone inválido');
        }
        
        return true;
    }
}

class Livro {
    static async cadastrar(dadosLivro) {
        const { titulo, autor, genero, estadoConservacao, isbn, editora, anoPublicacao } = dadosLivro;
        
        try {
            const result = await pool.query(
                'INSERT INTO livros (titulo, autor, genero, estado_conservacao, isbn, editora, ano_publicacao) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
                [titulo, autor, genero, estadoConservacao, isbn, editora, anoPublicacao]
            );
            return result.rows[0];
        } catch (error) {
            console.error('Erro ao cadastrar livro:', error);
            throw new Error('Erro ao cadastrar livro');
        }
    }

    static async atualizar(id, dadosLivro) {
        const { titulo, autor, genero, estadoConservacao, isbn, editora, anoPublicacao } = dadosLivro;
        
        try {
            const result = await pool.query(
                'UPDATE livros SET titulo = $1, autor = $2, genero = $3, estado_conservacao = $4, isbn = $5, editora = $6, ano_publicacao = $7, data_atualizacao = CURRENT_TIMESTAMP WHERE id = $8 AND ativo = true RETURNING *',
                [titulo, autor, genero, estadoConservacao, isbn, editora, anoPublicacao, id]
            );
            return result.rows[0];
        } catch (error) {
            console.error('Erro ao atualizar livro:', error);
            throw new Error('Erro ao atualizar livro');
        }
    }

    static async excluir(id) {
        try {
            await pool.query('UPDATE livros SET ativo = false WHERE id = $1', [id]);
            return { success: true, message: 'Livro removido com sucesso' };
        } catch (error) {
            console.error('Erro ao excluir livro:', error);
            throw new Error('Erro ao excluir livro');
        }
    }

    static async buscarPorTitulo(titulo) {
        try {
            const result = await pool.query(
                'SELECT * FROM livros WHERE titulo ILIKE $1 AND ativo = true ORDER BY titulo',
                [`%${titulo}%`]
            );
            return result.rows;
        } catch (error) {
            console.error('Erro ao buscar livros por título:', error);
            throw error;
        }
    }

    static async buscarPorAutor(autor) {
        try {
            const result = await pool.query(
                'SELECT * FROM livros WHERE autor ILIKE $1 AND ativo = true ORDER BY autor, titulo',
                [`%${autor}%`]
            );
            return result.rows;
        } catch (error) {
            console.error('Erro ao buscar livros por autor:', error);
            throw error;
        }
    }

    static async listarPublico() {
        try {
            const result = await pool.query(
                'SELECT titulo, autor, genero FROM livros WHERE ativo = true ORDER BY titulo'
            );
            return result.rows;
        } catch (error) {
            console.error('Erro ao listar livros público:', error);
            throw error;
        }
    }

    static async listar() {
        try {
            const result = await pool.query(
                'SELECT * FROM livros WHERE ativo = true ORDER BY titulo'
            );
            return result.rows;
        } catch (error) {
            console.error('Erro ao listar livros:', error);
            throw error;
        }
    }
}

class Doacao {
    static async registrarIntencao(dadosDoacao) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { doadorEmail, descricaoGeral, itens, doadorDados } = dadosDoacao;
            
            // Buscar ou criar doador
            let doador = await Doador.buscarPorEmail(doadorEmail);
            
            if (!doador && doadorDados) {
                const resultadoCadastro = await Doador.cadastrar(doadorDados);
                if (resultadoCadastro.success) {
                    doador = resultadoCadastro.doador;
                } else {
                    throw new Error(resultadoCadastro.message);
                }
            }
            
            if (!doador) {
                throw new Error('Doador não encontrado. Cadastre-se primeiro ou forneça dados completos.');
            }
            
            // Gerar protocolo único
            let protocolo;
            let tentativas = 0;
            do {
                protocolo = 'DOA' + (Date.now() + tentativas).toString().slice(-8);
                const existe = await client.query('SELECT id FROM doacoes WHERE protocolo = $1', [protocolo]);
                if (existe.rows.length === 0) break;
                tentativas++;
            } while (tentativas < 10);
            
            if (tentativas >= 10) {
                throw new Error('Erro ao gerar protocolo único');
            }
            
            // Criar doação
            const resultDoacao = await client.query(
                'INSERT INTO doacoes (doador_id, descricao_geral, protocolo) VALUES ($1, $2, $3) RETURNING *',
                [doador.id, descricaoGeral, protocolo]
            );
            
            const doacao = resultDoacao.rows[0];
            
            // Adicionar itens da doação (se fornecidos)
            if (itens && itens.length > 0) {
                for (const item of itens) {
                    await client.query(
                        'INSERT INTO itens_doacao (doacao_id, titulo, autor, quantidade, descricao, estado_conservacao) VALUES ($1, $2, $3, $4, $5, $6)',
                        [doacao.id, item.titulo, item.autor, item.quantidade || 1, item.descricao, item.estadoConservacao]
                    );
                }
            }
            
            await client.query('COMMIT');
            return { success: true, doacao, protocolo };
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Erro ao registrar intenção de doação:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async buscarPorProtocolo(protocolo) {
        try {
            const result = await pool.query(
                'SELECT d.*, doador.nome_completo, doador.email, doador.telefone FROM doacoes d JOIN doadores doador ON d.doador_id = doador.id WHERE d.protocolo = $1',
                [protocolo]
            );
            return result.rows[0] || null;
        } catch (error) {
            console.error('Erro ao buscar doação por protocolo:', error);
            throw error;
        }
    }

    static async listarPendentes() {
        try {
            const result = await pool.query(
                'SELECT d.*, doador.nome_completo, doador.email, doador.telefone FROM doacoes d JOIN doadores doador ON d.doador_id = doador.id WHERE d.status = $1 ORDER BY d.data_intencao ASC',
                ['pendente']
            );
            return result.rows;
        } catch (error) {
            console.error('Erro ao listar doações pendentes:', error);
            throw error;
        }
    }

    static async confirmarRecebimento(doacaoId, administradorId) {
        try {
            const result = await pool.query(
                'UPDATE doacoes SET status = $1, data_confirmacao = CURRENT_TIMESTAMP, administrador_id = $2 WHERE id = $3 AND status = $4 RETURNING *',
                ['confirmada', administradorId, doacaoId, 'pendente']
            );
            
            if (result.rows.length === 0) {
                throw new Error('Doação não encontrada ou já processada');
            }
            
            return { success: true, doacao: result.rows[0] };
        } catch (error) {
            console.error('Erro ao confirmar doação:', error);
            throw error;
        }
    }

    static async listarPorDoador(doadorId, limite = 50) {
        try {
            const result = await pool.query(
                'SELECT d.*, admin.nome as admin_nome FROM doacoes d LEFT JOIN administradores admin ON d.administrador_id = admin.id WHERE d.doador_id = $1 ORDER BY d.data_intencao DESC LIMIT $2',
                [doadorId, limite]
            );
            return result.rows;
        } catch (error) {
            console.error('Erro ao listar doações por doador:', error);
            throw error;
        }
    }
}

class Administrador {
    static async autenticar(username, password) {
        try {
            const result = await pool.query(
                'SELECT * FROM administradores WHERE username = $1 AND ativo = true',
                [username]
            );
            
            if (result.rows.length === 0) {
                return { success: false, message: 'Usuário não encontrado' };
            }
            
            const admin = result.rows[0];
            const passwordValido = await bcrypt.compare(password, admin.password_hash);
            
            if (!passwordValido) {
                return { success: false, message: 'Senha incorreta' };
            }
            
            // Atualizar último login
            await pool.query(
                'UPDATE administradores SET ultimo_login = CURRENT_TIMESTAMP WHERE id = $1',
                [admin.id]
            );
            
            const token = jwt.sign(
                { id: admin.id, username: admin.username, nome: admin.nome },
                process.env.JWT_SECRET || 'chave-secreta-padrao',
                { expiresIn: '8h' }
            );
            
            return { 
                success: true, 
                token, 
                admin: { 
                    id: admin.id, 
                    username: admin.username, 
                    nome: admin.nome,
                    email: admin.email 
                }
            };
        } catch (error) {
            console.error('Erro na autenticação:', error);
            throw new Error('Erro interno na autenticação');
        }
    }

    static async buscarPorId(id) {
        try {
            const result = await pool.query(
                'SELECT id, username, nome, email, data_criacao, ultimo_login FROM administradores WHERE id = $1 AND ativo = true',
                [id]
            );
            return result.rows[0] || null;
        } catch (error) {
            console.error('Erro ao buscar administrador:', error);
            throw error;
        }
    }

    static async alterarSenha(adminId, senhaAtual, novaSenha) {
        try {
            const result = await pool.query(
                'SELECT password_hash FROM administradores WHERE id = $1 AND ativo = true', 
                [adminId]
            );
            
            if (result.rows.length === 0) {
                return { success: false, message: 'Administrador não encontrado' };
            }
            
            const passwordValido = await bcrypt.compare(senhaAtual, result.rows[0].password_hash);
            
            if (!passwordValido) {
                return { success: false, message: 'Senha atual incorreta' };
            }
            
            const novaPasswordHash = await bcrypt.hash(novaSenha, 10);
            
            await pool.query(
                'UPDATE administradores SET password_hash = $1 WHERE id = $2',
                [novaPasswordHash, adminId]
            );
            
            return { success: true, message: 'Senha alterada com sucesso' };
        } catch (error) {
            console.error('Erro ao alterar senha:', error);
            throw new Error('Erro interno ao alterar senha');
        }
    }
}

class Campanha {
    static async criar(dadosCampanha) {
        const { titulo, descricao, meta, metaTipo, dataTermino, administradorId, publicoAlvo, generoAlvo } = dadosCampanha;
        
        try {
            const result = await pool.query(
                'INSERT INTO campanhas (titulo, descricao, meta, meta_tipo, data_termino, administrador_id, publico_alvo, generos_alvo) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
                [titulo, descricao, meta, metaTipo || 'livros', dataTermino, administradorId, publicoAlvo, generoAlvo]
            );
            return result.rows[0];
        } catch (error) {
            console.error('Erro ao criar campanha:', error);
            throw new Error('Erro ao criar campanha');
        }
    }

    static async editar(id, dadosCampanha) {
        const { titulo, descricao, meta, metaTipo, dataTermino, publicoAlvo, generoAlvo } = dadosCampanha;
        
        try {
            const result = await pool.query(
                'UPDATE campanhas SET titulo = $1, descricao = $2, meta = $3, meta_tipo = $4, data_termino = $5, publico_alvo = $6, generos_alvo = $7, data_atualizacao = CURRENT_TIMESTAMP WHERE id = $8 AND ativa = true RETURNING *',
                [titulo, descricao, meta, metaTipo, dataTermino, publicoAlvo, generoAlvo, id]
            );
            return result.rows[0];
        } catch (error) {
            console.error('Erro ao editar campanha:', error);
            throw new Error('Erro ao editar campanha');
        }
    }

    static async encerrar(id) {
        try {
            const result = await pool.query(
                'UPDATE campanhas SET ativa = false, data_atualizacao = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
                [id]
            );
            return { success: true, message: 'Campanha encerrada com sucesso', campanha: result.rows[0] };
        } catch (error) {
            console.error('Erro ao encerrar campanha:', error);
            throw new Error('Erro ao encerrar campanha');
        }
    }

    static async listarAtivas() {
        try {
            const result = await pool.query(
                'SELECT c.*, admin.nome as admin_nome FROM campanhas c JOIN administradores admin ON c.administrador_id = admin.id WHERE c.ativa = true AND (c.data_termino IS NULL OR c.data_termino >= CURRENT_DATE) ORDER BY c.prioridade DESC, c.data_inicio DESC'
            );
            return result.rows;
        } catch (error) {
            console.error('Erro ao listar campanhas ativas:', error);
            throw error;
        }
    }

    static async listar() {
        try {
            const result = await pool.query(
                'SELECT c.*, admin.nome as admin_nome FROM campanhas c JOIN administradores admin ON c.administrador_id = admin.id ORDER BY c.data_inicio DESC'
            );
            return result.rows;
        } catch (error) {
            console.error('Erro ao listar campanhas:', error);
            throw error;
        }
    }

    static async verificarVigencia() {
        try {
            const result = await pool.query(
                'UPDATE campanhas SET ativa = false, data_atualizacao = CURRENT_TIMESTAMP WHERE ativa = true AND data_termino < CURRENT_DATE RETURNING id, titulo'
            );
            
            if (result.rows.length > 0) {
                console.log(`📅 ${result.rows.length} campanhas encerradas automaticamente por vencimento`);
            }
            
            return result.rows;
        } catch (error) {
            console.error('Erro ao verificar vigência das campanhas:', error);
            throw error;
        }
    }
}

class Recibo {
    static async gerar(doacaoId, client = null) {
        const dbClient = client || pool;
        
        try {
            // Gerar número único
            let numeroRecibo;
            let tentativas = 0;
            do {
                numeroRecibo = 'REC' + (Date.now() + tentativas).toString().slice(-8);
                const existe = await dbClient.query('SELECT id FROM recibos WHERE numero_recibo = $1', [numeroRecibo]);
                if (existe.rows.length === 0) break;
                tentativas++;
            } while (tentativas < 10);
            
            if (tentativas >= 10) {
                throw new Error('Erro ao gerar número único de recibo');
            }
            
            const result = await dbClient.query(
                'INSERT INTO recibos (doacao_id, numero_recibo) VALUES ($1, $2) RETURNING *',
                [doacaoId, numeroRecibo]
            );
            
            const recibo = result.rows[0];
            
            // Enviar por email automaticamente (não esperar pelo resultado)
            if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
                setImmediate(async () => {
                    try {
                        await Recibo.enviarPorEmail(recibo.id);
                    } catch (error) {
                        console.error('Erro ao enviar recibo por email (background):', error);
                    }
                });
            }
            
            return recibo;
        } catch (error) {
            console.error('Erro ao gerar recibo:', error);
            throw error;
        }
    }

    static async enviarPorEmail(reciboId) {
        try {
            // Incrementar contador de tentativas
            await pool.query(
                'UPDATE recibos SET tentativas_envio = tentativas_envio + 1 WHERE id = $1',
                [reciboId]
            );
            
            // Buscar dados completos do recibo e doação
            const result = await pool.query(`
                SELECT 
                    r.numero_recibo, r.data_geracao,
                    d.protocolo, d.descricao_geral, d.data_confirmacao,
                    doador.nome_completo, doador.email,
                    admin.nome as admin_nome
                FROM recibos r
                JOIN doacoes d ON r.doacao_id = d.id
                JOIN doadores doador ON d.doador_id = doador.id
                LEFT JOIN administradores admin ON d.administrador_id = admin.id
                WHERE r.id = $1
            `, [reciboId]);
            
            if (result.rows.length === 0) {
                throw new Error('Recibo não encontrado');
            }
            
            const dados = result.rows[0];
            
            // Verificar se email está configurado
            if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
                console.warn('⚠️  Configuração de email não encontrada - recibo não enviado');
                return { success: false, message: 'Configuração de email não encontrada' };
            }
            
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: dados.email,
                subject: '📧 Recibo de Doação - Biblioteca Comunitária',
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <style>
                            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                            .header { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                            .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
                            .info-box { background: white; padding: 15px; margin: 15px 0; border-radius: 5px; border-left: 4px solid #28a745; }
                            .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h1>📚 Biblioteca Comunitária</h1>
                                <h2>Comprovante de Doação</h2>
                            </div>
                            <div class="content">
                                <p>Olá, <strong>${dados.nome_completo}</strong>!</p>
                                
                                <p>É com grande alegria que confirmamos o recebimento da sua generosa doação de livros. Sua contribuição é fundamental para fortalecer nossa comunidade através da leitura!</p>
                                
                                <div class="info-box">
                                    <h3>📋 Detalhes da Doação</h3>
                                    <p><strong>Número do Recibo:</strong> ${dados.numero_recibo}</p>
                                    <p><strong>Protocolo da Doação:</strong> ${dados.protocolo}</p>
                                    <p><strong>Data de Confirmação:</strong> ${new Date(dados.data_confirmacao).toLocaleDateString('pt-BR', { 
                                        day: '2-digit', month: '2-digit', year: 'numeric', 
                                        hour: '2-digit', minute: '2-digit' 
                                    })}</p>
                                    ${dados.descricao_geral ? `<p><strong>Descrição:</strong> ${dados.descricao_geral}</p>` : ''}
                                    ${dados.admin_nome ? `<p><strong>Processado por:</strong> ${dados.admin_nome}</p>` : ''}
                                </div>
                                
                                <p>🎉 <strong>Obrigado por fazer a diferença!</strong> Seus livros doados agora fazem parte do nosso acervo e estarão disponíveis para toda a comunidade.</p>
                                
                                <p>Continue acompanhando nosso trabalho e considere fazer novas doações quando possível. Juntos, construímos uma comunidade mais educada e informada!</p>
                                
                                <p>📚 Para consultar nosso catálogo ou fazer novas doações, visite nosso sistema.</p>
                            </div>
                            <div class="footer">
                                <p>Este é um e-mail automático gerado pelo Sistema de Doações da Biblioteca Comunitária.</p>
                                <p>Guarde este comprovante para seus registros.</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `
            };
            
            await transporter.sendMail(mailOptions);
            
            // Marcar como enviado
            await pool.query(
                'UPDATE recibos SET enviado_email = true, data_envio_email = CURRENT_TIMESTAMP WHERE id = $1',
                [reciboId]
            );
            
            console.log(`📧 Recibo ${dados.numero_recibo} enviado por email para ${dados.email}`);
            return { success: true, message: 'Email enviado com sucesso' };
            
        } catch (error) {
            console.error('Erro ao enviar recibo por email:', error);
            
            // Registrar erro no banco
            await pool.query(
                'UPDATE recibos SET ultimo_erro_envio = $1 WHERE id = $2',
                [error.message, reciboId]
            );
            
            return { success: false, message: 'Erro ao enviar email: ' + error.message };
        }
    }

    static async buscarPorDoacao(doacaoId) {
        try {
            const result = await pool.query(
                'SELECT * FROM recibos WHERE doacao_id = $1',
                [doacaoId]
            );
            return result.rows[0] || null;
        } catch (error) {
            console.error('Erro ao buscar recibo por doação:', error);
            throw error;
        }
    }
}

class PainelImpacto {
    static async obterDadosPublicos() {
        try {
            const results = await Promise.all([
                pool.query("SELECT COUNT(*) as total FROM doacoes WHERE status = 'confirmada'"),
                pool.query("SELECT COUNT(DISTINCT doador_id) as total FROM doacoes WHERE status = 'confirmada'"),
                pool.query("SELECT COUNT(*) as total FROM livros WHERE ativo = true"),
                pool.query("SELECT COUNT(*) as total FROM livros WHERE ativo = true AND data_cadastro >= DATE_TRUNC('month', CURRENT_DATE)"),
                pool.query("SELECT COALESCE(SUM(id.quantidade), 0) as total FROM itens_doacao id JOIN doacoes d ON id.doacao_id = d.id WHERE d.status = 'confirmada'")
            ]);

            return {
                totalDoacoes: parseInt(results[0].rows[0].total) || 0,
                totalDoadores: parseInt(results[1].rows[0].total) || 0,
                totalLivros: parseInt(results[2].rows[0].total) || 0,
                novosTitulosUltimoMes: parseInt(results[3].rows[0].total) || 0,
                totalLivrosDoados: parseInt(results[4].rows[0].total) || 0
            };
        } catch (error) {
            console.error('Erro ao obter dados do painel de impacto:', error);
            return {
                totalDoacoes: 0,
                totalDoadores: 0,
                totalLivros: 0,
                novosTitulosUltimoMes: 0,
                totalLivrosDoados: 0
            };
        }
    }

    static async atualizarIndicadores() {
        return await PainelImpacto.obterDadosPublicos();
    }
}

// ===============================================
// ROTAS PRINCIPAIS
// ===============================================

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0'
    });
});

// Página inicial
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===============================================
// API ENDPOINTS PÚBLICOS
// ===============================================

// UC01: Cadastrar doador
app.post('/api/doadores', async (req, res) => {
    try {
        const { nomeCompleto, email, telefone } = req.body;
        
        if (!nomeCompleto || !email || !telefone) {
            return res.status(400).json({
                success: false,
                message: 'Nome completo, email e telefone são obrigatórios'
            });
        }
        
        Doador.validarDados({ nomeCompleto: nomeCompleto.trim(), email: email.trim().toLowerCase(), telefone: telefone.trim() });
        
        const resultado = await Doador.cadastrar({
            nomeCompleto: nomeCompleto.trim(),
            email: email.trim().toLowerCase(),
            telefone: telefone.trim()
        });
        
        res.json(resultado);
    } catch (error) {
        console.error('Erro ao cadastrar doador:', error);
        res.status(400).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// UC02: Registrar intenção de doação
app.post('/api/doacoes/intencao', async (req, res) => {
    try {
        const { doadorEmail, descricaoGeral, itens, doadorDados } = req.body;
        
        if (!doadorEmail || !descricaoGeral) {
            return res.status(400).json({
                success: false,
                message: 'Email do doador e descrição da doação são obrigatórios'
            });
        }
        
        const resultado = await Doacao.registrarIntencao({
            doadorEmail: doadorEmail.trim().toLowerCase(),
            descricaoGeral: descricaoGeral.trim(),
            itens: itens || [],
            doadorDados: doadorDados
        });
        
        res.json(resultado);
    } catch (error) {
        console.error('Erro ao registrar intenção de doação:', error);
        res.status(400).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Consultar doação por protocolo
app.get('/api/doacoes/protocolo/:protocolo', async (req, res) => {
    try {
        const { protocolo } = req.params;
        
        if (!protocolo || !/^DOA\d{8}$/.test(protocolo)) {
            return res.status(400).json({
                success: false,
                message: 'Protocolo inválido. Use o formato DOA12345678'
            });
        }
        
        const doacao = await Doacao.buscarPorProtocolo(protocolo.toUpperCase());
        
        if (!doacao) {
            return res.status(404).json({ 
                success: false, 
                message: 'Doação não encontrada' 
            });
        }
        
        res.json(doacao);
    } catch (error) {
        console.error('Erro ao consultar doação:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro interno do servidor' 
        });
    }
});

// UC08: Visualizar acervo público
app.get('/api/livros/publico', async (req, res) => {
    try {
        const { titulo, autor, limite = 100 } = req.query;
        let livros;
        
        if (titulo) {
            livros = await Livro.buscarPorTitulo(titulo);
        } else if (autor) {
            livros = await Livro.buscarPorAutor(autor);
        } else {
            livros = await Livro.listarPublico();
        }
        
        if (livros.length > limite) {
            livros = livros.slice(0, limite);
        }
        
        res.json(livros);
    } catch (error) {
        console.error('Erro ao listar livros públicos:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao carregar catálogo' 
        });
    }
});

// UC10: Visualizar campanhas ativas
app.get('/api/campanhas/ativas', async (req, res) => {
    try {
        await Campanha.verificarVigencia();
        const campanhas = await Campanha.listarAtivas();
        res.json(campanhas);
    } catch (error) {
        console.error('Erro ao listar campanhas ativas:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao carregar campanhas' 
        });
    }
});

// UC11: Painel de impacto
app.get('/api/painel-impacto', async (req, res) => {
    try {
        const dados = await PainelImpacto.obterDadosPublicos();
        res.json(dados);
    } catch (error) {
        console.error('Erro ao obter dados do painel de impacto:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao carregar dados de impacto' 
        });
    }
});

// ===============================================
// ROTAS DE AUTENTICAÇÃO
// ===============================================

// UC04: Login de administrador
app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Usuário e senha são obrigatórios'
            });
        }
        
        const resultado = await Administrador.autenticar(username.trim(), password);
        
        if (!resultado.success) {
            return res.status(401).json(resultado);
        }
        
        res.json(resultado);
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro interno do servidor' 
        });
    }
});

// ===============================================
// ROTAS ADMINISTRATIVAS (PROTEGIDAS)
// ===============================================

// Verificar token (para debugging)
app.get('/api/admin/verify', verificarToken, async (req, res) => {
    try {
        const admin = await Administrador.buscarPorId(req.admin.id);
        res.json({ success: true, admin });
    } catch (error) {
        console.error('Erro ao verificar token:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro interno' 
        });
    }
});

// Listar doações pendentes
app.get('/api/admin/doacoes/pendentes', verificarToken, async (req, res) => {
    try {
        const doacoes = await Doacao.listarPendentes();
        res.json(doacoes);
    } catch (error) {
        console.error('Erro ao listar doações pendentes:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao carregar doações pendentes' 
        });
    }
});

// UC07: Confirmar doação
app.put('/api/admin/doacoes/:id/confirmar', verificarToken, async (req, res) => {
    try {
        const doacaoId = parseInt(req.params.id);
        
        if (isNaN(doacaoId)) {
            return res.status(400).json({
                success: false,
                message: 'ID da doação inválido'
            });
        }
        
        const resultado = await Doacao.confirmarRecebimento(doacaoId, req.admin.id);
        
        // Gerar recibo automaticamente
        if (resultado.success) {
            try {
                const recibo = await Recibo.gerar(doacaoId);
                resultado.recibo = recibo;
            } catch (error) {
                console.error('Erro ao gerar recibo:', error);
            }
        }
        
        res.json(resultado);
    } catch (error) {
        console.error('Erro ao confirmar doação:', error);
        res.status(400).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// UC05 & UC06: CRUD de Livros
app.get('/api/admin/livros', verificarToken, async (req, res) => {
    try {
        const { titulo, autor } = req.query;
        let livros;
        
        if (titulo) {
            livros = await Livro.buscarPorTitulo(titulo);
        } else if (autor) {
            livros = await Livro.buscarPorAutor(autor);
        } else {
            livros = await Livro.listar();
        }
        
        res.json(livros);
    } catch (error) {
        console.error('Erro ao listar livros (admin):', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao carregar livros' 
        });
    }
});

app.post('/api/admin/livros', verificarToken, async (req, res) => {
    try {
        const { titulo, autor } = req.body;
        
        if (!titulo || !autor) {
            return res.status(400).json({
                success: false,
                message: 'Título e autor são obrigatórios'
            });
        }
        
        const livro = await Livro.cadastrar(req.body);
        res.json({ success: true, livro });
    } catch (error) {
        console.error('Erro ao cadastrar livro:', error);
        res.status(400).json({ 
            success: false, 
            message: error.message 
        });
    }
});

app.put('/api/admin/livros/:id', verificarToken, async (req, res) => {
    try {
        const livroId = parseInt(req.params.id);
        
        if (isNaN(livroId)) {
            return res.status(400).json({
                success: false,
                message: 'ID do livro inválido'
            });
        }
        
        const livro = await Livro.atualizar(livroId, req.body);
        
        if (!livro) {
            return res.status(404).json({ 
                success: false, 
                message: 'Livro não encontrado' 
            });
        }
        
        res.json({ success: true, livro });
    } catch (error) {
        console.error('Erro ao atualizar livro:', error);
        res.status(400).json({ 
            success: false, 
            message: error.message 
        });
    }
});

app.delete('/api/admin/livros/:id', verificarToken, async (req, res) => {
    try {
        const livroId = parseInt(req.params.id);
        
        if (isNaN(livroId)) {
            return res.status(400).json({
                success: false,
                message: 'ID do livro inválido'
            });
        }
        
        const resultado = await Livro.excluir(livroId);
        res.json(resultado);
    } catch (error) {
        console.error('Erro ao excluir livro:', error);
        res.status(400).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// UC09: Gestão de Campanhas
app.get('/api/admin/campanhas', verificarToken, async (req, res) => {
    try {
        const campanhas = await Campanha.listar();
        res.json(campanhas);
    } catch (error) {
        console.error('Erro ao listar campanhas (admin):', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao carregar campanhas' 
        });
    }
});

app.post('/api/admin/campanhas', verificarToken, async (req, res) => {
    try {
        const { titulo, descricao } = req.body;
        
        if (!titulo || !descricao) {
            return res.status(400).json({
                success: false,
                message: 'Título e descrição são obrigatórios'
            });
        }
        
        const dadosCampanha = { 
            ...req.body, 
            administradorId: req.admin.id 
        };
        
        const campanha = await Campanha.criar(dadosCampanha);
        res.json({ success: true, campanha });
    } catch (error) {
        console.error('Erro ao criar campanha:', error);
        res.status(400).json({ 
            success: false, 
            message: error.message 
        });
    }
});

app.put('/api/admin/campanhas/:id', verificarToken, async (req, res) => {
    try {
        const campanhaId = parseInt(req.params.id);
        
        if (isNaN(campanhaId)) {
            return res.status(400).json({
                success: false,
                message: 'ID da campanha inválido'
            });
        }
        
        const campanha = await Campanha.editar(campanhaId, req.body);
        
        if (!campanha) {
            return res.status(404).json({ 
                success: false, 
                message: 'Campanha não encontrada' 
            });
        }
        
        res.json({ success: true, campanha });
    } catch (error) {
        console.error('Erro ao editar campanha:', error);
        res.status(400).json({ 
            success: false, 
            message: error.message 
        });
    }
});

app.delete('/api/admin/campanhas/:id', verificarToken, async (req, res) => {
    try {
        const campanhaId = parseInt(req.params.id);
        
        if (isNaN(campanhaId)) {
            return res.status(400).json({
                success: false,
                message: 'ID da campanha inválido'
            });
        }
        
        const resultado = await Campanha.encerrar(campanhaId);
        res.json(resultado);
    } catch (error) {
        console.error('Erro ao encerrar campanha:', error);
        res.status(400).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Alterar senha do administrador
app.put('/api/admin/senha', verificarToken, async (req, res) => {
    try {
        const { senhaAtual, novaSenha } = req.body;
        
        if (!senhaAtual || !novaSenha) {
            return res.status(400).json({
                success: false,
                message: 'Senha atual e nova senha são obrigatórias'
            });
        }
        
        if (novaSenha.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Nova senha deve ter pelo menos 6 caracteres'
            });
        }
        
        const resultado = await Administrador.alterarSenha(req.admin.id, senhaAtual, novaSenha);
        res.json(resultado);
    } catch (error) {
        console.error('Erro ao alterar senha:', error);
        res.status(400).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Listar doadores (para administração)
app.get('/api/admin/doadores', verificarToken, async (req, res) => {
    try {
        const { limite = 100, offset = 0 } = req.query;
        const doadores = await Doador.listar(parseInt(limite), parseInt(offset));
        res.json(doadores);
    } catch (error) {
        console.error('Erro ao listar doadores:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao carregar doadores' 
        });
    }
});

// ===============================================
// TRATAMENTO DE ERROS E ROTAS NÃO ENCONTRADAS
// ===============================================

// Para rotas da API não encontradas
app.use('/api', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint não encontrado'
    });
});

// Para todas as outras rotas, servir o index.html (SPA)
app.get('/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handler global de erros
app.use((error, req, res, next) => {
    console.error('❌ Erro não tratado:', error);
    
    res.status(500).json({
        success: false,
        message: process.env.NODE_ENV === 'production' 
            ? 'Erro interno do servidor' 
            : error.message
    });
});

// ===============================================
// INICIALIZAÇÃO DO SERVIDOR
// ===============================================

async function iniciarServidor() {
    try {
        // Testar conexão com banco
        await pool.query('SELECT NOW()');
        console.log('✅ Conexão com banco de dados estabelecida');
        
        // Verificar vigência das campanhas na inicialização
        await Campanha.verificarVigencia();
        
        // Iniciar servidor
        app.listen(PORT, () => {
            console.log('🚀 Servidor iniciado com sucesso!');
            console.log(`📍 URL: http://localhost:${PORT}`);
            console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
            console.log(`📊 Banco: ${process.env.DB_NAME || 'biblioteca_doacoes'}`);
            console.log(`📧 Email: ${process.env.EMAIL_USER ? 'Configurado' : 'Não configurado'}`);
            console.log('─'.repeat(50));
        });
        
    } catch (error) {
        console.error('❌ Falha ao iniciar servidor:', error);
        process.exit(1);
    }
}

// ===============================================
// GRACEFUL SHUTDOWN
// ===============================================

process.on('SIGINT', async () => {
    console.log('\n🔄 Encerrando servidor graciosamente...');
    
    try {
        await pool.end();
        console.log('✅ Conexões com banco fechadas');
        console.log('👋 Servidor encerrado');
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro ao encerrar:', error);
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    console.log('🔄 Recebido SIGTERM, encerrando...');
    await pool.end();
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Exceção não capturada:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rejeitada não tratada:', reason);
    process.exit(1);
});

// Inicializar aplicação
iniciarServidor();

// Exportar app para testes
module.exports = app;
