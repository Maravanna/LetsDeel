const express = require('express')
const bodyParser = require('body-parser')
const { Op } = require("sequelize")

const { sequelize } = require('./model')
const { getProfile } = require('./middleware/getProfile')

const app = express();

app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * @returns contract by id
 */
app.get('/contracts/:id', getProfile, async(req, res) => {
    const { Contract } = req.app.get('models')
    const { id } = req.params
    const { profile_id } = req.headers

    const contract = await Contract.findOne({ where: { id, ClientId: profile_id } })

    if (!contract) return res.status(404).end()

    res.json(contract)
})

/**
 * @returns all contracts
 */
app.get('/contracts', getProfile, async(req, res) => {
    const { Contract } = req.app.get('models')
    const { profile_id } = req.headers

    const contracts = await Contract.findAll({
        where: {
            [Op.or]: [
                { ClientId: profile_id },
                { ContractorId: profile_id }
            ],
            status: {
                [Op.not]: "terminated"
            }
        }
    })

    res.json(contracts)
})

/**
 * @returns unpaid jobs
 */
app.get('/jobs/unpaid', getProfile, async(req, res) => {
    const { Job, Contract } = req.app.get('models')
    const { profile_id } = req.headers

    const jobs = await Job.findAll({
        include: {
            model: Contract,
            where: {
                [Op.or]: [
                    { ClientId: profile_id },
                    { ContractorId: profile_id }
                ],
                status: {
                    [Op.not]: "terminated"
                }
            }
        },
        where: {
            paid: {
                [Op.not]: true
            }
        }
    })

    res.json(jobs)
})

/**
 * @returns pay jobs
 */
app.post('/jobs/:job_id/pay', async(req, res) => {
    const { Job, Contract, Profile } = req.app.get('models')
    const { job_id } = req.params

    const job = await Job.findOne({
        include: {
            model: Contract,
            include: [{
                    model: Profile,
                    as: 'Client'
                },
                {
                    model: Profile,
                    as: 'Contractor'
                }
            ]
        },
        where: {
            id: job_id
        }
    })

    if (!job) return res.status(404).end()

    if (job.Contract.Client.balance < job.price) {
        return res.status(201).send("Insufficient funds")
    }

    job.Contract.Client.balance -= job.price
    job.Contract.Contractor.balance += job.price
    job.paid = true
    job.paymentDate = Date.now()

    job.save()

    res.json(job)
})

/**
 * @returns depoist
 */
app.post('/balances/deposit/:userId', async(req, res) => {
    const { Job, Contract, Profile } = req.app.get('models')
    const { value } = req.body
    const { userId } = req.params

    const profile = await Profile.findOne({
        include: {
            model: Contract,
            as: "Client",
            include: {
                model: Job,
                where: {
                    paid: {
                        [Op.not]: true
                    }
                }
            }
        },
        where: { id: userId, type: "client" }
    })

    const allJobs = profile.Client.map(c => c.Jobs).flat()
    const dueAmount = allJobs.reduce((acc, { price }) => acc + price, 0)

    if (value > dueAmount * 0.25) {
        return res.status(201).send("It is not possible to add more than 25% off the amount that you have to pay")
    }

    profile.balance += value;

    profile.save();

    res.json(profile)
})

/**
 * @returns best profession
 */
app.get('/admin/best-profession', async(req, res) => {
    const { Job, Contract, Profile } = req.app.get('models')
    const { start, end } = req.query

    const profiles = await Profile.findAll({
        include: {
            model: Contract,
            as: "Contractor",
            include: {
                model: Job,
                where: {
                    paid: true,
                    paymentDate: {
                        [Op.between]: [new Date(start), new Date(end)]
                    }
                }
            }
        },
        where: { type: "contractor" }
    })


    const jobSalaries = profiles.reduce((acc, profile) => {
        const profession = profile.profession
        const amount = profile.Contractor.map(c => c.Jobs).flat().reduce((acc, { price }) => acc + price, 0)

        return {...acc, [profession]: acc[profession] ? acc[profession] + amount : amount }
    }, {})

    const orderdSalaries = Object.keys(jobSalaries).reduce((a, b) => jobSalaries[a] > jobSalaries[b] ? a : b)

    res.json(orderdSalaries)
})

/**
 * @returns best clients
 */
app.get('/admin/best-clients', async(req, res) => {
    const { Job, Contract, Profile } = req.app.get('models')
    const { start, end, limit = 2 } = req.query;

    const profiles = await Profile.findAll({
        include: {
            model: Contract,
            as: "Client",
            include: {
                model: Job,
                where: {
                    paid: true,
                    paymentDate: {
                        [Op.between]: [new Date(start), new Date(end)]
                    }
                }
            }
        },
        where: { type: "client" }
    })

    const mappedProfiles = profiles.map(({ Client, id, firstName, lastName }) => {
        return {
            id,
            fullName: `${firstName} ${lastName}`,
            paid: Client.map(c => c.Jobs).flat().reduce((acc, { price }) => acc + price, 0)
        }
    }).sort((a, b) => b.paid - a.paid).slice(0, limit)

    res.json(mappedProfiles)
})

module.exports = app;